from __future__ import annotations

import hashlib
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .client import NcmClient, NcmError
from .ratelimit import RateLimiter
from .security import tokens_match
from .store import ShipmentStore

REF_PATTERN = r"^GT-\d{6}-\d{4}$"
AWB_PATTERN = r"^\d{4,12}$"
TRACK_PATTERN = r"^(GT-\d{6}-\d{4}|\d{4,12})$"
PHONE_PATTERN = r"^9[678]\d{8}$"
BRANCH_PATTERN = r"^[A-Z0-9][A-Z0-9 .()/&-]{1,59}$"
DELIVERY_TYPES = {"home": "Door2Door", "branch": "Door2Branch"}


def clean(value: str) -> str:
    return " ".join("".join(ch for ch in value if ch.isprintable()).split())


class Dimensions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    length_cm: float = Field(gt=0, le=200)
    width_cm: float = Field(gt=0, le=200)
    height_cm: float = Field(gt=0, le=200)


class ShipmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    ref: str = Field(pattern=REF_PATTERN)
    name: str = Field(min_length=2, max_length=80)
    phone: str = Field(pattern=PHONE_PATTERN)
    phone2: str = Field(default="", pattern=r"^(9[678]\d{8})?$")
    address: str = Field(min_length=3, max_length=200)
    branch: str = Field(pattern=BRANCH_PATTERN)
    delivery: Literal["home", "branch"]
    cod_charge: int = Field(ge=0, le=500_000)
    package: str = Field(default="", max_length=120)
    instruction: str = Field(default="", max_length=200)
    weight: float = Field(default=1.0, gt=0, le=30)
    dimensions: Dimensions | None = None

    @field_validator("name", "address", "package", "instruction")
    @classmethod
    def _printable(cls, value: str) -> str:
        return clean(value)

    def ncm_payload(self, pickup_branch: str) -> dict[str, str]:
        parts = [f"Receiver: {self.name}"]
        if self.instruction:
            parts.append(self.instruction.rstrip("."))
        if self.dimensions:
            d = self.dimensions
            parts.append(f"Size {d.length_cm:g}x{d.width_cm:g}x{d.height_cm:g} cm")
        instruction = ". ".join(parts)
        return {
            "name": self.name,
            "phone": self.phone,
            "phone2": self.phone2,
            "cod_charge": str(self.cod_charge),
            "address": self.address,
            "fbranch": pickup_branch,
            "branch": self.branch,
            "package": self.package,
            "vref_id": self.ref,
            "instruction": instruction[:200],
            "delivery_type": DELIVERY_TYPES[self.delivery],
            "weight": f"{self.weight:g}",
        }


class Services:
    def __init__(
        self,
        *,
        client: NcmClient | None,
        store: ShipmentStore,
        admin_key: str | None,
        pickup_branch: str,
        track_limiter: RateLimiter,
        auth_limiter: RateLimiter,
        webhook_secret: str | None = None,
        public_base_url: str = "",
        branch_for: Any = None,
    ) -> None:
        self.client = client
        self.store = store
        self.admin_key = admin_key
        self.pickup_branch = pickup_branch
        self.track_limiter = track_limiter
        self.auth_limiter = auth_limiter
        self.webhook_secret = webhook_secret
        self.public_base_url = public_base_url
        self.branch_for = branch_for or (lambda key: key)


def services(request: Request) -> Services:
    return request.app.state.ncm


def client_ip(request: Request) -> str:
    if getattr(request.app.state, "trust_proxy", False):
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()[:64]
    return request.client.host if request.client else "unknown"


def ncm_client(svc: Services) -> NcmClient:
    if svc.client is None:
        raise HTTPException(status_code=503, detail="NCM is not configured")
    return svc.client


def require_admin(
    request: Request,
    svc: Annotated[Services, Depends(services)],
    authorization: Annotated[str, Header()] = "",
) -> None:
    if not svc.admin_key:
        raise HTTPException(status_code=503, detail="Admin access is not configured")
    scheme, _, provided = authorization.partition(" ")
    if scheme.lower() == "bearer" and provided and tokens_match(svc.admin_key, provided):
        return
    if not svc.auth_limiter.allow(client_ip(request)):
        raise HTTPException(status_code=429, detail="Too many attempts. Wait a minute.")
    raise HTTPException(status_code=401, detail="Wrong admin key", headers={"WWW-Authenticate": "Bearer"})


def public_status(item: dict[str, Any]) -> dict[str, str]:
    at = next((item[k] for k in ("added_time", "created_at", "date", "time") if item.get(k)), "")
    return {"status": clean(str(item.get("status", "")))[:80], "at": str(at)[:40]}


async def ship(svc: Services, body: ShipmentRequest) -> dict[str, Any]:
    client = ncm_client(svc)
    if not svc.pickup_branch:
        raise HTTPException(status_code=503, detail="NCM_PICKUP_BRANCH is not set")
    fresh, existing, uncertain = svc.store.reserve(body.ref, body.phone)
    if not fresh:
        if existing:
            return {"ref": body.ref, "ncm_id": existing, "created": False}
        if uncertain:
            raise HTTPException(
                status_code=409,
                detail="The last attempt timed out and may have reached NCM. Check the NCM portal, then resolve it in the admin.",
            )
        raise HTTPException(status_code=409, detail="This shipment is already being created")
    try:
        payload = body.ncm_payload(svc.pickup_branch)
        payload["branch"] = svc.branch_for(body.branch)
        ncm_id = await client.create_order(payload)
    except NcmError as exc:
        if exc.code == "NCM_TIMEOUT":
            svc.store.mark_uncertain(body.ref)
        else:
            svc.store.release(body.ref)
        raise HTTPException(status_code=exc.status, detail=exc.message) from None
    svc.store.complete(body.ref, ncm_id)
    return {"ref": body.ref, "ncm_id": ncm_id, "created": True}


Svc = Annotated[Services, Depends(services)]


class ResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ncm_id: str = Field(default="", pattern=r"^(\d{4,12})?$")


def build_router() -> APIRouter:
    router = APIRouter()

    @router.post("/ncm/shipments", dependencies=[Depends(require_admin)])
    async def create_shipment(body: ShipmentRequest, svc: Svc) -> dict[str, Any]:
        return await ship(svc, body)

    @router.get("/ncm/shipments/{ref}", dependencies=[Depends(require_admin)])
    async def shipment(ref: Annotated[str, Path(pattern=REF_PATTERN)], svc: Svc) -> dict[str, Any]:
        client = ncm_client(svc)
        ncm_id = svc.store.ncm_id(ref)
        if not ncm_id:
            raise HTTPException(status_code=404, detail="No NCM shipment for this order")
        try:
            details = await client.order_details(ncm_id)
            statuses = await client.order_statuses(ncm_id)
            comments = await client.order_comments(ncm_id)
        except NcmError as exc:
            raise HTTPException(status_code=exc.status, detail=exc.message) from None
        return {"ref": ref, "ncm_id": ncm_id, "details": details, "statuses": statuses, "comments": comments}

    @router.post("/api/admin/shipments/{ref}/resolve", dependencies=[Depends(require_admin)])
    async def resolve(ref: Annotated[str, Path(pattern=REF_PATTERN)], body: ResolveRequest, svc: Svc) -> dict[str, Any]:
        if body.ncm_id:
            svc.store.complete(ref, body.ncm_id)
            return {"ref": ref, "ncm_id": body.ncm_id}
        svc.store.release(ref)
        return {"ref": ref, "ncm_id": None}

    @router.get("/ncm/track")
    async def track(
        request: Request,
        svc: Svc,
        phone: Annotated[str, Query(pattern=PHONE_PATTERN)],
        ref: Annotated[str, Query(pattern=TRACK_PATTERN)],
    ) -> dict[str, Any]:
        if not svc.track_limiter.allow(client_ip(request)):
            raise HTTPException(status_code=429, detail="Too many lookups. Wait a minute.")
        client = ncm_client(svc)
        found = svc.store.lookup_for_customer(ref, phone)
        if not found:
            raise HTTPException(status_code=404, detail="Not found")
        try:
            statuses = await client.order_statuses(found[1])
        except NcmError as exc:
            raise HTTPException(status_code=503 if exc.status == 503 else 502, detail="Tracking is unavailable right now") from None
        return {"ref": found[0], "statuses": [public_status(s) for s in statuses]}

    @router.post("/api/admin/ncm/webhook", dependencies=[Depends(require_admin)])
    async def register_webhook(svc: Svc) -> dict[str, str]:
        client = ncm_client(svc)
        if not svc.webhook_secret or not svc.public_base_url.startswith("https://"):
            raise HTTPException(status_code=503, detail="Set NCM_WEBHOOK_SECRET and an https PUBLIC_BASE_URL first")
        try:
            await client.set_webhook(f"{svc.public_base_url}/api/ncm/webhook?token={svc.webhook_secret}")
        except NcmError as exc:
            raise HTTPException(status_code=exc.status, detail=exc.message) from None
        return {"status": "registered"}

    return router


def webhook_key(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()
