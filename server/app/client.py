from __future__ import annotations

import asyncio
import logging
import random
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

import httpx

logger = logging.getLogger(__name__)

PRODUCTION_URL = "https://portal.nepalcanmove.com"
DEMO_URL = "https://demo.nepalcanmove.com"
RETRYABLE_STATUS = {429, 502, 503, 504}


class EventSink(Protocol):
    def __call__(self, *, ref: str, op: str, code: str, http_status: int, message: str) -> None: ...


class NcmError(Exception):
    def __init__(self, message: str, status: int = 502, code: str = "NCM_REJECTED") -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


def _safe_message(data: Any) -> str:
    if isinstance(data, dict):
        for key in ("message", "detail", "error", "Error"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()[:200]
        for key, value in data.items():
            if isinstance(value, list) and value and isinstance(value[0], str):
                return f"{key}: {value[0]}"[:200]
            if isinstance(value, str) and value.strip():
                return f"{key}: {value}"[:200]
    if isinstance(data, list) and data and isinstance(data[0], str):
        return data[0][:200]
    return "NCM rejected the request"


def _quiet(**_: Any) -> None:
    return None


class NcmClient:
    def __init__(
        self,
        *,
        http: httpx.AsyncClient,
        token: str,
        base_url: str,
        timeout: float = 25.0,
        max_retries: int = 3,
        events: EventSink = _quiet,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        if base_url not in (PRODUCTION_URL, DEMO_URL):
            raise ValueError("NCM_BASE_URL must be the NCM portal or demo host")
        self._http = http
        self._token = token
        self._base = base_url
        self._timeout = httpx.Timeout(timeout, connect=5.0)
        self._retries = max(1, max_retries)
        self._events = events
        self._sleep = sleep

    async def _request(
        self,
        method: str,
        path: str,
        *,
        ref: str,
        op: str,
        params: dict[str, str] | None = None,
        body: dict[str, Any] | None = None,
        safe_to_repeat: bool,
    ) -> Any:
        last: NcmError | None = None
        for attempt in range(self._retries):
            if attempt:
                await self._sleep(min(8.0, 0.5 * 2 ** (attempt - 1)) + random.uniform(0, 0.25))
            try:
                response = await self._http.request(
                    method,
                    self._base + path,
                    params=params,
                    json=body,
                    headers={"Authorization": f"Token {self._token}", "Accept": "application/json"},
                    timeout=self._timeout,
                    follow_redirects=False,
                )
            except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as exc:
                last = NcmError("NCM is not reachable right now", 503, "NCM_UNREACHABLE")
                self._record(ref, op, last, 0, type(exc).__name__)
                continue
            except httpx.HTTPError as exc:
                last = NcmError("NCM did not answer in time", 504, "NCM_TIMEOUT")
                self._record(ref, op, last, 0, type(exc).__name__)
                if safe_to_repeat:
                    continue
                raise last from None
            logger.info("NCM %s %s -> %s", method, path, response.status_code)
            try:
                data = response.json()
            except ValueError:
                data = None
            if response.status_code < 400:
                return data
            if response.status_code in (401, 403):
                last = NcmError("NCM refused the API token", 502, "NCM_AUTH")
            elif response.status_code in RETRYABLE_STATUS:
                last = NcmError("NCM is busy, try again shortly", 503, "NCM_BUSY")
            elif response.status_code >= 500:
                last = NcmError("NCM had an internal error", 502, "NCM_SERVER")
            else:
                last = NcmError(_safe_message(data), 422, "NCM_REJECTED")
            self._record(ref, op, last, response.status_code, last.message)
            repeat = response.status_code == 429 or (safe_to_repeat and response.status_code in RETRYABLE_STATUS)
            if not repeat:
                raise last
        assert last is not None
        raise last

    def _record(self, ref: str, op: str, error: NcmError, http_status: int, detail: str) -> None:
        logger.warning("NCM %s %s failed: %s %s", op, ref, error.code, detail)
        try:
            self._events(ref=ref, op=op, code=error.code, http_status=http_status, message=detail)
        except Exception:
            logger.exception("Could not record NCM event")

    async def create_order(self, payload: dict[str, Any]) -> str:
        ref = str(payload.get("vref_id", ""))
        data = await self._request(
            "POST", "/api/v1/order/create", ref=ref, op="create", body=payload, safe_to_repeat=False
        )
        order_id = data.get("orderid") if isinstance(data, dict) else None
        if order_id in (None, ""):
            error = NcmError(_safe_message(data), 502, "NCM_BAD_RESPONSE")
            self._record(ref, "create", error, 200, error.message)
            raise error
        return str(order_id)

    async def order_details(self, ncm_id: str) -> dict[str, Any]:
        data = await self._request(
            "GET", "/api/v1/order", ref=ncm_id, op="details", params={"id": ncm_id}, safe_to_repeat=True
        )
        return data if isinstance(data, dict) else {}

    async def order_statuses(self, ncm_id: str) -> list[dict[str, Any]]:
        data = await self._request(
            "GET", "/api/v1/order/status", ref=ncm_id, op="status", params={"id": ncm_id}, safe_to_repeat=True
        )
        return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []

    async def shipping_rate(self, origin: str, destination: str, kind: str) -> int:
        data = await self._request(
            "GET", "/api/v1/shipping-rate", ref=destination, op="rate",
            params={"creation": origin, "destination": destination, "type": kind}, safe_to_repeat=True,
        )
        try:
            return round(float(data.get("charge")))
        except (AttributeError, TypeError, ValueError):
            raise NcmError("NCM returned no price", 502, "NCM_BAD_RESPONSE") from None

    async def order_comments(self, ncm_id: str) -> list[dict[str, Any]]:
        data = await self._request(
            "GET", "/api/v1/order/comment", ref=ncm_id, op="comments", params={"id": ncm_id}, safe_to_repeat=True
        )
        return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []

    async def set_webhook(self, url: str) -> None:
        await self._request(
            "POST", "/api/v2/vendor/webhook", ref="webhook", op="webhook", body={"webhook_url": url}, safe_to_repeat=True
        )
