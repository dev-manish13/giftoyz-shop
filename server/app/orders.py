from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import random
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .client import NcmError
from .context import Context, get_context
from .db import dumps
from .invoice import render_invoice
from .khalti import KhaltiError
from .rates import sync_rates
from .routes import (
    PHONE_PATTERN,
    REF_PATTERN,
    TRACK_PATTERN,
    Services,
    ShipmentRequest,
    clean,
    client_ip,
    public_status,
    require_admin,
    services,
    ship,
    webhook_key,
)
from .security import add_nonce, nonce, page_policy, tokens_match

logger = logging.getLogger(__name__)
NPT = timezone(timedelta(hours=5, minutes=45))
STATUSES = ("payment_pending", "received", "confirmed", "with_ncm", "in_transit", "delivered", "cancelled")
TRANSITIONS = {
    "payment_pending": {"confirmed", "cancelled"},
    "received": {"confirmed", "cancelled"},
    "confirmed": {"in_transit", "cancelled"},
    "with_ncm": {"in_transit", "delivered", "cancelled"},
    "in_transit": {"delivered", "cancelled"},
    "delivered": set(),
    "cancelled": set(),
}
_BACKGROUND: set[asyncio.Task[Any]] = set()
STOCK_HELD = {"payment_pending", "received", "confirmed", "with_ncm", "in_transit", "delivered"}

Ctx = Annotated[Context, Depends(get_context)]
Svc = Annotated[Services, Depends(services)]


class CartLine(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int = Field(gt=0, lt=1_000_000)
    color: str = Field(min_length=2, max_length=20)
    qty: int = Field(ge=1, le=20)


class Gift(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str = Field(default="", max_length=200)
    hideSlip: bool = True

    @field_validator("note")
    @classmethod
    def _printable(cls, value: str) -> str:
        return clean(value)


class OrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    ref: str = Field(default="", pattern=r"^(GT-\d{6}-\d{4})?$")
    items: list[CartLine] = Field(min_length=1, max_length=20)
    name: str = Field(min_length=2, max_length=80)
    phone: str = Field(pattern=PHONE_PATTERN)
    phone2: str = Field(default="", pattern=r"^(9[678]\d{8})?$")
    location_key: str = Field(min_length=2, max_length=60)
    district: str = Field(default="", max_length=40)
    delivery: Literal["home", "branch"]
    address: str = Field(min_length=6, max_length=200)
    gift: Gift | None = None
    mode: Literal["cod", "full"]
    wallet: Literal["esewa", "khalti", "bank"] = "esewa"
    txn: str = Field(default="", max_length=40)
    lang: Literal["en", "ne"] = "en"

    @field_validator("name", "address", "district", "txn")
    @classmethod
    def _printable(cls, value: str) -> str:
        return clean(value)


class StatusChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["confirmed", "in_transit", "delivered", "cancelled"]


class PayRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    order_id: str = Field(pattern=REF_PATTERN)
    token: str = Field(min_length=20, max_length=80)


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat().replace("+00:00", "Z")


def _title(key: str) -> str:
    return " ".join(w.capitalize() for w in key.split()).replace("Newroad", "New Road")


def public_order(order: dict[str, Any]) -> dict[str, Any]:
    pay = order["payment"]
    return {
        "id": order["id"],
        "createdAt": order["createdAt"],
        "status": order["status"],
        "history": order["history"],
        "items": [{k: i[k] for k in ("id", "name", "color", "qty", "price")} for i in order["items"]],
        "location": order["location"],
        "subtotal": order["subtotal"],
        "total": order["total"],
        "payment": {k: pay[k] for k in ("mode", "wallet", "paidNow", "due", "verified", "gateway")},
        "ncm": {"id": order["ncm"]["id"]} if order.get("ncm") else None,
    }


class Orders:
    def __init__(self, ctx: Context) -> None:
        self.ctx = ctx
        self.db = ctx.db

    def _new_id(self, conn: Any, proposed: str = "") -> str:
        today = datetime.fromtimestamp(self.db.clock(), NPT)
        day = today.strftime("%y%m%d")
        near = {(today + timedelta(days=d)).strftime("%y%m%d") for d in (-1, 0, 1)}
        if proposed and proposed[3:9] in near and conn.execute("SELECT 1 FROM orders WHERE id = ?", (proposed,)).fetchone() is None:
            return proposed
        for _ in range(50):
            candidate = f"GT-{day}-{random.randint(1000, 9999)}"
            if conn.execute("SELECT 1 FROM orders WHERE id = ?", (candidate,)).fetchone() is None:
                return candidate
        raise HTTPException(status_code=503, detail="Too many orders today. Message us on WhatsApp.")

    def create(self, body: OrderRequest, phone_digest: str) -> tuple[dict[str, Any], str]:
        shop = self.ctx.shop.get()
        if shop.orders_paused:
            raise HTTPException(status_code=503, detail=shop.pause_en if body.lang == "en" else shop.pause_ne or shop.pause_en)
        rate = self.ctx.rates.get(body.location_key.upper())
        if rate is None:
            raise HTTPException(status_code=422, detail="We don't deliver to that place. Pick one from the list.")
        fee = rate.home if body.delivery == "home" else rate.branch
        gateway = "khalti" if body.wallet == "khalti" and self.ctx.khalti is not None else None
        token = secrets.token_urlsafe(24)
        now = self.db.clock()
        with self.db.tx() as conn:
            wanted: dict[int, int] = {}
            items = []
            for line in body.items:
                row = conn.execute("SELECT data FROM products WHERE num_id = ? AND visible = 1", (line.id,)).fetchone()
                if row is None:
                    raise HTTPException(status_code=409, detail="An item in your cart is no longer available.")
                product = json.loads(row["data"])
                if product.get("price") is None:
                    raise HTTPException(status_code=409, detail=f"{product['name']} has no price yet.")
                if line.color not in product["colors"]:
                    raise HTTPException(status_code=422, detail=f"{product['name']} doesn't come in that colour.")
                wanted[line.id] = wanted.get(line.id, 0) + line.qty
                if wanted[line.id] > int(product.get("stock", 0)):
                    raise HTTPException(status_code=409, detail=f"Only {product.get('stock', 0)} left of {product['name']}.")
                items.append({
                    "id": line.id, "itemId": product["itemId"], "name": product["name"], "color": line.color,
                    "qty": line.qty, "price": int(product["price"]), "weight_kg": float(product.get("weight_kg", 0.5)),
                })
            subtotal = sum(i["price"] * i["qty"] for i in items)
            total = subtotal + fee
            paid_now = total if body.mode == "full" else (fee if shop.codAdvance else 0)
            status = "payment_pending" if paid_now > 0 else "received"
            order_id = self._new_id(conn, body.ref)
            order = {
                "id": order_id, "createdAt": _iso(now), "lang": body.lang, "server": True,
                "name": body.name, "phone": body.phone, "phone2": body.phone2,
                "location": {"key": rate.key, "name": _title(rate.key), "district": body.district, "type": body.delivery, "fee": fee},
                "address": body.address,
                "gift": body.gift.model_dump() if body.gift else None,
                "payment": {
                    "mode": body.mode, "wallet": body.wallet if paid_now > 0 else None, "gateway": gateway,
                    "txn": body.txn if paid_now > 0 and gateway is None else "", "paidNow": paid_now,
                    "due": total - paid_now, "screenshot": None, "verified": False, "pidx": None,
                },
                "items": items, "subtotal": subtotal, "total": total, "status": status,
                "history": [{"at": _iso(now), "status": status}], "ncm": None,
            }
            for num_id, qty in wanted.items():
                self.ctx.catalog.adjust_stock(conn, num_id, -qty)
            conn.execute(
                "INSERT INTO orders (id, phone_digest, token_digest, status, data, created_ts, updated_ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (order_id, phone_digest, _digest(token), status, dumps(order), now, now),
            )
        return order, token

    def get(self, order_id: str) -> dict[str, Any] | None:
        row = self.db.one("SELECT data FROM orders WHERE id = ?", (order_id,))
        return json.loads(row["data"]) if row else None

    def for_token(self, order_id: str, token: str) -> dict[str, Any]:
        row = self.db.one("SELECT data, token_digest FROM orders WHERE id = ?", (order_id,))
        expected = row["token_digest"] if row else _digest("")
        if not hmac.compare_digest(expected, _digest(token)) or row is None:
            raise HTTPException(status_code=404, detail="Order not found")
        return json.loads(row["data"])

    def for_customer(self, order_id: str, phone: str) -> dict[str, Any] | None:
        order = self.get(order_id)
        if order is None or not hmac.compare_digest(order["phone"], phone):
            return None
        return order

    def list(self, limit: int) -> list[dict[str, Any]]:
        rows = self.db.query("SELECT data FROM orders ORDER BY created_ts DESC LIMIT ?", (limit,))
        return [json.loads(r["data"]) for r in rows]

    def mutate(self, order_id: str, fn: Any) -> dict[str, Any]:
        with self.db.tx() as conn:
            row = conn.execute("SELECT data FROM orders WHERE id = ?", (order_id,)).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="Order not found")
            order = json.loads(row["data"])
            fn(order, conn)
            conn.execute(
                "UPDATE orders SET data = ?, status = ?, updated_ts = ? WHERE id = ?",
                (dumps(order), order["status"], self.db.clock(), order_id),
            )
        return order

    def push_status(self, order: dict[str, Any], status: str, conn: Any, note: str = "") -> None:
        before = order["status"]
        if before == status:
            return
        if before in STOCK_HELD and status == "cancelled":
            for item in order["items"]:
                self.ctx.catalog.adjust_stock(conn, item["id"], item["qty"])
        order["status"] = status
        if status == "confirmed":
            order["payment"]["verified"] = True
        entry = {"at": _iso(self.db.clock()), "status": status}
        if note:
            entry["note"] = note[:120]
        order["history"].append(entry)


def _orders(ctx: Ctx) -> Orders:
    return Orders(ctx)


Ord = Annotated[Orders, Depends(_orders)]


FINAL_WORDS = ("return", "cancel", "reject")
MOVING_WORDS = ("picked", "pickup complete", "collected", "dispatch", "transit", "arrived", "sent for delivery", "out for delivery", "drop off", "sent to", "received at")


def ncm_to_status(text: str) -> str | None:
    t = text.lower()
    if any(w in t for w in FINAL_WORDS):
        return None
    if re.search(r"(?<!un)(?<!not )\bdelivered\b", t):
        return "delivered"
    if "created" not in t and any(w in t for w in MOVING_WORDS):
        return "in_transit"
    return None


def is_final(text: str) -> bool:
    t = text.lower()
    return ncm_to_status(text) == "delivered" or any(w in t for w in FINAL_WORDS)


def _when(item: dict[str, str]) -> datetime:
    raw = item.get("at", "")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%d %b %Y %H:%M"):
        try:
            return datetime.strptime(raw[:19], fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return datetime.min


def latest_status(statuses: list[dict[str, str]]) -> str:
    if not statuses:
        return ""
    dated = [s for s in statuses if _when(s) != datetime.min]
    return (max(dated, key=_when) if dated else statuses[0])["status"]


def _timeline(statuses: list[dict[str, str]]) -> list[dict[str, str]]:
    return sorted(statuses, key=_when, reverse=True)[:30]


def apply_ncm(orders: Orders, svc: Services, ref: str, statuses: list[dict[str, str]], details: dict[str, Any] | None = None) -> str:
    latest = latest_status(statuses)
    if not latest:
        return ""
    svc.store.set_status(ref, latest)
    target = ncm_to_status(latest)
    if orders.get(ref) is not None:
        def apply(order: dict[str, Any], conn: Any) -> None:
            if order.get("ncm"):
                order["ncm"]["status"] = latest
                order["ncm"]["timeline"] = _timeline(statuses)
                order["ncm"]["checked"] = _iso(orders.db.clock())
                if details:
                    branch = details.get("destination_branch_name")
                    phone = details.get("destination_branch_phone")
                    if branch:
                        order["ncm"]["branch"] = clean(str(branch))[:60]
                    if phone:
                        order["ncm"]["branch_phone"] = clean(str(phone))[:40]
                    if details.get("trackid"):
                        order["ncm"]["trackid"] = clean(str(details["trackid"]))[:40]
            if target == "delivered" and order["status"] == "with_ncm":
                orders.push_status(order, "in_transit", conn, f"NCM: {latest}")
            if target and target in TRANSITIONS.get(order["status"], set()):
                orders.push_status(order, target, conn, f"NCM: {latest}")

        orders.mutate(ref, apply)
    return latest


async def poll_ncm(ctx: Context, svc: Services, *, interval: float, pause: float = 1.0) -> None:
    orders = Orders(ctx)
    while True:
        await asyncio.sleep(interval)
        if svc.client is None:
            continue
        checked = 0
        for ref, ncm_id, last in svc.store.active():
            if last and is_final(last):
                continue
            order = orders.get(ref)
            try:
                raw = await svc.client.order_statuses(ncm_id)
                details = await svc.client.order_details(ncm_id) if order and order.get("ncm") and "branch_phone" not in order["ncm"] else None
            except NcmError:
                continue
            except Exception:
                logger.exception("NCM status check failed for %s", ref)
                continue
            apply_ncm(orders, svc, ref, [public_status(s) for s in raw], details)
            checked += 1
            await asyncio.sleep(pause)
        if checked:
            logger.info("Checked %d NCM shipments", checked)


async def _verify_khalti(ctx: Context, orders: Orders, pidx: str) -> tuple[str, str]:
    row = ctx.db.one("SELECT order_id, amount_paisa, status FROM payments WHERE pidx = ?", (pidx,))
    if row is None or ctx.khalti is None:
        return "", "failed"
    order_id = row["order_id"]
    if row["status"] == "Completed":
        return order_id, "success"
    try:
        result = await ctx.khalti.lookup(pidx)
    except KhaltiError:
        return order_id, "pending"
    if result.status != "Completed":
        with ctx.db.tx() as conn:
            conn.execute(
                "UPDATE payments SET status = ?, updated_ts = ? WHERE pidx = ? AND status != 'Completed'",
                (result.status[:30] or "Unknown", ctx.db.clock(), pidx),
            )
        return order_id, "pending" if result.status in ("Pending", "Initiated") else "failed"
    if result.total_amount != row["amount_paisa"] or result.pidx != pidx:
        logger.error("Khalti amount mismatch for %s: expected %s got %s", pidx, row["amount_paisa"], result.total_amount)
        with ctx.db.tx() as conn:
            conn.execute("UPDATE payments SET status = 'Mismatch', updated_ts = ? WHERE pidx = ?", (ctx.db.clock(), pidx))
        return order_id, "failed"

    def settle(order: dict[str, Any], conn: Any) -> None:
        claimed = conn.execute(
            "UPDATE payments SET status = 'Completed', transaction_id = ?, updated_ts = ? WHERE pidx = ? AND status != 'Completed'",
            (result.transaction_id[:60], ctx.db.clock(), pidx),
        ).rowcount
        if not claimed:
            return
        pay = order["payment"]
        if pay.get("verified") and pay.get("pidx") and pay["pidx"] != pidx:
            order["history"].append({"at": _iso(ctx.db.clock()), "status": order["status"], "note": f"Duplicate Khalti payment {pidx}. Refund it."})
            return
        pay["pidx"] = pidx
        pay["txn"] = result.transaction_id[:60]
        if order["status"] == "payment_pending":
            orders.push_status(order, "confirmed", conn, "Paid by Khalti")
        else:
            pay["verified"] = True

    orders.mutate(order_id, settle)
    return order_id, "success"


def build_orders_router() -> APIRouter:
    router = APIRouter()

    @router.post("/api/orders")
    async def create_order(request: Request, body: OrderRequest, ctx: Ctx, orders: Ord, svc: Svc) -> dict[str, Any]:
        if not ctx.order_limiter.allow(client_ip(request)):
            raise HTTPException(status_code=429, detail="Too many orders from this connection. Wait a minute.")
        order, token = orders.create(body, svc.store.digest(body.phone))
        return {"order": public_order(order), "token": token, "khalti": order["payment"]["gateway"] == "khalti"}

    @router.get("/api/orders/{order_id}")
    async def get_order(
        order_id: Annotated[str, Path(pattern=REF_PATTERN)],
        token: Annotated[str, Query(min_length=20, max_length=80)],
        orders: Ord,
    ) -> dict[str, Any]:
        return {"order": public_order(orders.for_token(order_id, token))}

    @router.get("/invoice/{order_id}")
    async def invoice(
        ctx: Ctx,
        orders: Ord,
        order_id: Annotated[str, Path(pattern=REF_PATTERN)],
        token: Annotated[str, Query(min_length=20, max_length=80)],
    ) -> HTMLResponse:
        order = orders.for_token(order_id, token)
        colours = {c.id: c.en for c in ctx.taxonomy.get().colors}
        value = nonce()
        body = add_nonce(render_invoice(order, ctx.shop.get().model_dump(), colours), value)
        policy = page_policy(value, ctx.settings.public_base_url.startswith("https://"))
        return HTMLResponse(body, headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Content-Security-Policy": policy})

    @router.get("/api/track")
    async def track(
        request: Request,
        ctx: Ctx,
        orders: Ord,
        svc: Svc,
        q: Annotated[str, Query(pattern=TRACK_PATTERN)],
        phone: Annotated[str, Query(pattern=PHONE_PATTERN)],
    ) -> dict[str, Any]:
        if not svc.track_limiter.allow(client_ip(request)):
            raise HTTPException(status_code=429, detail="Too many lookups. Wait a minute.")
        shipment = svc.store.lookup_for_customer(q, phone)
        ref = shipment[0] if shipment else q
        order = orders.for_customer(ref, phone) if ref.startswith("GT-") else None
        if order is None and shipment is None:
            raise HTTPException(status_code=404, detail="Not found")
        statuses: list[dict[str, str]] = []
        live = True
        if shipment and svc.client is not None:
            try:
                statuses = _timeline([public_status(s) for s in await svc.client.order_statuses(shipment[1])])
                apply_ncm(orders, svc, shipment[0], statuses)
            except NcmError:
                live = False
        if order is not None and statuses:
            order = orders.for_customer(ref, phone)
        if not statuses and order is not None and (order.get("ncm") or {}).get("timeline"):
            statuses, live = order["ncm"]["timeline"], False
        ncm_info = (order or {}).get("ncm") or {}
        return {
            "branch": {"name": ncm_info.get("branch", ""), "phone": ncm_info.get("branch_phone", "")} if ncm_info.get("branch") else None,
            "checked": ncm_info.get("checked", ""),
            "ref": ref,
            "awb": shipment[1] if shipment else None,
            "order": public_order(order) if order else None,
            "statuses": statuses,
            "live": live,
        }

    @router.post("/api/payments/khalti/initiate")
    async def khalti_initiate(request: Request, body: PayRequest, ctx: Ctx, orders: Ord) -> dict[str, str]:
        if ctx.khalti is None:
            raise HTTPException(status_code=503, detail="Khalti is not available")
        if not ctx.pay_limiter.allow(client_ip(request)):
            raise HTTPException(status_code=429, detail="Too many attempts. Wait a minute.")
        order = orders.for_token(body.order_id, body.token)
        pay = order["payment"]
        if pay.get("gateway") != "khalti" or pay["paidNow"] <= 0:
            raise HTTPException(status_code=409, detail="This order isn't paid through Khalti")
        if pay.get("verified") or order["status"] != "payment_pending":
            raise HTTPException(status_code=409, detail="This order is already paid")
        amount = int(pay["paidNow"]) * 100
        now = datetime.now(timezone.utc)
        for row in ctx.db.query(
            "SELECT pidx, payment_url, expires_at FROM payments WHERE order_id = ? AND status = 'Initiated' ORDER BY created_ts DESC",
            (order["id"],),
        ):
            try:
                expires = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
            except ValueError:
                continue
            if expires.tzinfo and expires - now > timedelta(minutes=5):
                return {"payment_url": row["payment_url"], "pidx": row["pidx"]}
        base = ctx.settings.public_base_url
        try:
            started = await ctx.khalti.initiate(
                order_id=order["id"], amount_paisa=amount, name=order["name"], phone=order["phone"],
                return_url=f"{base}/api/payments/khalti/return", website_url=base,
            )
        except KhaltiError as exc:
            raise HTTPException(status_code=exc.status, detail=exc.message) from None
        with ctx.db.tx() as conn:
            conn.execute(
                "INSERT INTO payments (pidx, order_id, amount_paisa, status, payment_url, expires_at, created_ts, updated_ts) "
                "VALUES (?, ?, ?, 'Initiated', ?, ?, ?, ?)",
                (started.pidx, order["id"], amount, started.payment_url, started.expires_at, ctx.db.clock(), ctx.db.clock()),
            )
        return {"payment_url": started.payment_url, "pidx": started.pidx}

    @router.get("/api/payments/khalti/return")
    async def khalti_return(ctx: Ctx, orders: Ord, pidx: Annotated[str, Query(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9]+$")]) -> RedirectResponse:
        order_id, outcome = await _verify_khalti(ctx, orders, pidx)
        target = f"/checkout.html?order={order_id}&payment={outcome}" if order_id else "/checkout.html?payment=failed"
        return RedirectResponse(target, status_code=303)

    @router.post("/api/payments/khalti/verify")
    async def khalti_verify(body: PayRequest, ctx: Ctx, orders: Ord) -> dict[str, Any]:
        order = orders.for_token(body.order_id, body.token)
        row = ctx.db.one("SELECT pidx FROM payments WHERE order_id = ? ORDER BY created_ts DESC LIMIT 1", (order["id"],))
        outcome = (await _verify_khalti(ctx, orders, row["pidx"]))[1] if row else "failed"
        return {"payment": outcome, "order": public_order(orders.for_token(body.order_id, body.token))}

    @router.get("/api/admin/orders", dependencies=[Depends(require_admin)])
    async def admin_orders(orders: Ord, limit: Annotated[int, Query(ge=1, le=1000)] = 300) -> dict[str, Any]:
        return {"orders": orders.list(limit)}

    @router.post("/api/admin/orders/{order_id}/status", dependencies=[Depends(require_admin)])
    async def admin_status(order_id: Annotated[str, Path(pattern=REF_PATTERN)], body: StatusChange, orders: Ord) -> dict[str, Any]:
        def apply(order: dict[str, Any], conn: Any) -> None:
            if body.status not in TRANSITIONS[order["status"]]:
                raise HTTPException(status_code=409, detail=f"Can't go from {order['status']} to {body.status}")
            orders.push_status(order, body.status, conn)

        return {"order": orders.mutate(order_id, apply)}

    @router.post("/api/admin/orders/{order_id}/ship", dependencies=[Depends(require_admin)])
    async def admin_ship(order_id: Annotated[str, Path(pattern=REF_PATTERN)], orders: Ord, svc: Svc) -> dict[str, Any]:
        order = orders.get(order_id)
        if order is None:
            raise HTTPException(status_code=404, detail="Order not found")
        if order["status"] not in ("confirmed", "with_ncm"):
            raise HTTPException(status_code=409, detail="Confirm the order before sending it to NCM")
        location = order["location"]
        request = ShipmentRequest(
            ref=order["id"],
            name=order["name"][:80],
            phone=order["phone"],
            phone2=order.get("phone2", ""),
            address=f"{order['address']}, {location['name']}"[:200],
            branch=location["key"],
            delivery=location["type"],
            cod_charge=int(order["payment"]["due"]),
            package=", ".join(f"{i['qty']} x {i['name']}" for i in order["items"])[:120],
            instruction="Gift parcel. No price slip inside." if (order.get("gift") or {}).get("hideSlip") else "",
            weight=min(30.0, max(0.5, round(sum(i.get("weight_kg", 0.5) * i["qty"] for i in order["items"]), 2))),
        )
        result = await ship(svc, request)

        def apply(o: dict[str, Any], conn: Any) -> None:
            if not o.get("ncm"):
                o["ncm"] = {"id": result["ncm_id"], "at": _iso(orders.db.clock())}
            orders.push_status(o, "with_ncm", conn)

        return {**result, "order": orders.mutate(order_id, apply)}

    @router.get("/api/admin/rates", dependencies=[Depends(require_admin)])
    async def admin_rates(ctx: Ctx) -> dict[str, Any]:
        return {"rates": ctx.rates.rows(), "last_sync": ctx.rates.last_sync(), "running": ctx.rates.running}

    @router.post("/api/admin/rates/sync", status_code=202, dependencies=[Depends(require_admin)])
    async def admin_rates_sync(ctx: Ctx, svc: Svc) -> dict[str, Any]:
        if svc.client is None or not svc.pickup_branch:
            raise HTTPException(status_code=503, detail="NCM is not configured")
        if ctx.rates.running:
            raise HTTPException(status_code=409, detail="A price refresh is already running")
        task = asyncio.create_task(sync_rates(ctx.rates, svc.client, svc.pickup_branch))
        _BACKGROUND.add(task)
        task.add_done_callback(_BACKGROUND.discard)
        return {"started": True, "places": len(ctx.rates.all())}

    @router.get("/api/admin/ncm/events", dependencies=[Depends(require_admin)])
    async def ncm_events(ctx: Ctx, limit: Annotated[int, Query(ge=1, le=500)] = 100) -> dict[str, Any]:
        return {"events": ctx.db.ncm_events(limit)}

    @router.post("/api/ncm/webhook")
    async def ncm_webhook(
        request: Request, ctx: Ctx, orders: Ord, svc: Svc, token: Annotated[str, Query(max_length=200)] = ""
    ) -> dict[str, str]:
        if not svc.webhook_secret or not tokens_match(svc.webhook_secret, token):
            raise HTTPException(status_code=401, detail="Bad token")
        body = await request.body()
        if len(body) > 16_384:
            raise HTTPException(status_code=413, detail="Too large")
        try:
            payload = json.loads(body or b"{}")
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON") from None
        ncm_id = str(payload.get("order_id") or payload.get("orderid") or "") if isinstance(payload, dict) else ""
        if not ncm_id.isdigit():
            raise HTTPException(status_code=422, detail="Missing order_id")
        if not ctx.db.first_webhook(webhook_key(body)):
            return {"status": "duplicate"}
        ref = svc.store.ref_for(ncm_id)
        if ref is None or svc.client is None:
            return {"status": "ignored"}
        try:
            statuses = await svc.client.order_statuses(ncm_id)
        except NcmError:
            ctx.db.log_ncm(ref=ref, op="webhook", code="NCM_VERIFY_FAILED", http_status=0, message="Status check after webhook failed")
            return {"status": "deferred"}
        if not statuses:
            return {"status": "ignored"}
        apply_ncm(orders, svc, ref, [public_status(s) for s in statuses])
        return {"status": "ok"}

    return router
