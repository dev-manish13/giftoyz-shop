from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)

ALLOWED_HOSTS = ("https://dev.khalti.com/api/v2", "https://khalti.com/api/v2")
PAYMENT_URL_PREFIXES = ("https://test-pay.khalti.com/", "https://pay.khalti.com/")
MIN_PAISA = 1000


class KhaltiError(Exception):
    def __init__(self, message: str, status: int = 502) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


@dataclass(frozen=True)
class Initiated:
    pidx: str
    payment_url: str
    expires_at: str


@dataclass(frozen=True)
class Lookup:
    pidx: str
    status: str
    total_amount: int
    transaction_id: str


class KhaltiClient:
    def __init__(self, *, http: httpx.AsyncClient, secret_key: str, base_url: str, timeout: float = 20.0) -> None:
        if base_url not in ALLOWED_HOSTS:
            raise ValueError("Khalti base URL must be the official sandbox or production API")
        self._http = http
        self._key = secret_key
        self._base = base_url
        self._timeout = httpx.Timeout(timeout, connect=5.0)

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        try:
            response = await self._http.post(
                self._base + path,
                json=body,
                headers={"Authorization": f"Key {self._key}", "Accept": "application/json"},
                timeout=self._timeout,
                follow_redirects=False,
            )
        except httpx.HTTPError as exc:
            logger.warning("Khalti %s failed: %s", path, type(exc).__name__)
            raise KhaltiError("Khalti is not reachable right now", 503) from None
        logger.info("Khalti %s -> %s", path, response.status_code)
        try:
            data = response.json()
        except ValueError:
            data = {}
        if response.status_code in (401, 403):
            raise KhaltiError("Khalti refused the secret key", 502)
        if response.status_code >= 400 and not (path.endswith("lookup/") and isinstance(data, dict) and "status" in data):
            detail = data.get("detail") if isinstance(data, dict) else None
            raise KhaltiError(str(detail)[:200] if detail else "Khalti rejected the request", 422 if response.status_code < 500 else 502)
        return data if isinstance(data, dict) else {}

    async def initiate(
        self,
        *,
        order_id: str,
        amount_paisa: int,
        name: str,
        phone: str,
        return_url: str,
        website_url: str,
    ) -> Initiated:
        if amount_paisa < MIN_PAISA:
            raise KhaltiError("Khalti needs at least Rs 10", 422)
        data = await self._post(
            "/epayment/initiate/",
            {
                "return_url": return_url,
                "website_url": website_url,
                "amount": amount_paisa,
                "purchase_order_id": order_id,
                "purchase_order_name": f"GifToyz order {order_id}",
                "customer_info": {"name": name, "phone": phone},
            },
        )
        pidx, url = str(data.get("pidx", "")), str(data.get("payment_url", ""))
        if not pidx or not url.startswith(PAYMENT_URL_PREFIXES):
            raise KhaltiError("Khalti returned an unexpected response", 502)
        return Initiated(pidx=pidx, payment_url=url, expires_at=str(data.get("expires_at", "")))

    async def lookup(self, pidx: str) -> Lookup:
        data = await self._post("/epayment/lookup/", {"pidx": pidx})
        try:
            amount = int(data.get("total_amount") or 0)
        except (TypeError, ValueError):
            amount = 0
        return Lookup(
            pidx=str(data.get("pidx", pidx)),
            status=str(data.get("status", "")),
            total_amount=amount,
            transaction_id=str(data.get("transaction_id") or ""),
        )
