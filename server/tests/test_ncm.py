from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from app.client import NcmClient, NcmError
from app.main import create_app
from tests.conftest import ADMIN, AUTH, FakeNcm, make_settings

ORDER = {
    "ref": "GT-261108-4821",
    "name": "Sita Sharma",
    "phone": "9812345678",
    "address": "Near the main chowk",
    "branch": "POKHARA",
    "delivery": "home",
    "cod_charge": 1450,
    "package": "1 x Tumbler",
}


@pytest.fixture
def ncm_app(site):
    fake = FakeNcm()
    settings = make_settings(site, admin_api_key=ADMIN, ncm_pickup_branch="chitwan", track_limit_per_minute=3)
    with TestClient(create_app(settings, ncm_client=fake)) as client:
        yield client, fake


def test_admin_key_required(ncm_app) -> None:
    client, fake = ncm_app
    assert client.post("/ncm/shipments", json=ORDER).status_code == 401
    assert client.post("/ncm/shipments", json=ORDER, headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert fake.created == []


def test_failed_auth_is_rate_limited(ncm_app) -> None:
    client, _ = ncm_app
    codes = [client.get("/ncm/shipments/GT-261108-4821", headers={"Authorization": "Bearer x"}).status_code for _ in range(7)]
    assert codes[:5] == [401] * 5
    assert codes[5:] == [429, 429]


def test_create_shipment_maps_fields_and_is_idempotent(ncm_app) -> None:
    client, fake = ncm_app
    first = client.post("/ncm/shipments", json=ORDER, headers=AUTH)
    assert first.status_code == 200
    assert first.json() == {"ref": ORDER["ref"], "ncm_id": "4123456", "created": True}
    sent = fake.created[0]
    assert sent["fbranch"] == "CHITWAN"
    assert sent["delivery_type"] == "Door2Door"
    assert sent["vref_id"] == ORDER["ref"]
    assert sent["cod_charge"] == "1450"
    second = client.post("/ncm/shipments", json=ORDER, headers=AUTH)
    assert second.json()["created"] is False
    assert len(fake.created) == 1


def test_dimensions_go_into_instruction(ncm_app) -> None:
    client, fake = ncm_app
    body = {**ORDER, "instruction": "Fragile", "dimensions": {"length_cm": 30, "width_cm": 20, "height_cm": 12.5}}
    assert client.post("/ncm/shipments", json=body, headers=AUTH).status_code == 200
    assert fake.created[0]["instruction"] == "Receiver: Sita Sharma. Fragile. Size 30x20x12.5 cm"


@pytest.mark.parametrize(
    "field,value",
    [
        ("phone", "12345"),
        ("ref", "x'; DROP TABLE"),
        ("branch", "<script>"),
        ("cod_charge", -1),
        ("delivery", "air"),
        ("weight", 0),
        ("weight", 31),
        ("dimensions", {"length_cm": 0, "width_cm": 1, "height_cm": 1}),
    ],
)
def test_rejects_bad_input(ncm_app, field, value) -> None:
    client, fake = ncm_app
    assert client.post("/ncm/shipments", json={**ORDER, field: value}, headers=AUTH).status_code == 422
    assert fake.created == []


def test_rejects_unknown_fields(ncm_app) -> None:
    client, _ = ncm_app
    assert client.post("/ncm/shipments", json={**ORDER, "fbranch": "X"}, headers=AUTH).status_code == 422


def test_ncm_rejection_releases_reservation(ncm_app) -> None:
    client, fake = ncm_app
    fake.fail = NcmError("branch: invalid", 422)
    failed = client.post("/ncm/shipments", json=ORDER, headers=AUTH)
    assert failed.status_code == 422
    assert failed.json()["detail"] == "branch: invalid"
    fake.fail = None
    assert client.post("/ncm/shipments", json=ORDER, headers=AUTH).json()["created"] is True


def test_timeout_blocks_retry_until_resolved(ncm_app) -> None:
    client, fake = ncm_app
    fake.fail = NcmError("NCM did not answer in time", 504, "NCM_TIMEOUT")
    assert client.post("/ncm/shipments", json=ORDER, headers=AUTH).status_code == 504
    fake.fail = None
    blocked = client.post("/ncm/shipments", json=ORDER, headers=AUTH)
    assert blocked.status_code == 409
    assert "NCM portal" in blocked.json()["detail"]
    assert fake.created == []
    resolved = client.post(f"/api/admin/shipments/{ORDER['ref']}/resolve", json={"ncm_id": "4999999"}, headers=AUTH)
    assert resolved.json()["ncm_id"] == "4999999"
    again = client.post("/ncm/shipments", json=ORDER, headers=AUTH)
    assert again.json() == {"ref": ORDER["ref"], "ncm_id": "4999999", "created": False}


def test_track_needs_matching_phone_and_hides_extra_fields(ncm_app) -> None:
    client, _ = ncm_app
    client.post("/ncm/shipments", json=ORDER, headers=AUTH)
    wrong = client.get("/ncm/track", params={"ref": ORDER["ref"], "phone": "9800000000"})
    unknown = client.get("/ncm/track", params={"ref": "GT-261108-0000", "phone": ORDER["phone"]})
    assert wrong.status_code == unknown.status_code == 404
    ok = client.get("/ncm/track", params={"ref": ORDER["ref"], "phone": ORDER["phone"]})
    assert ok.status_code == 200
    assert ok.json()["statuses"] == [{"status": "Pickup Complete", "at": "2026-11-08 10:00"}]
    assert ok.headers["Cache-Control"] == "no-store"


def test_track_by_awb(ncm_app) -> None:
    client, _ = ncm_app
    client.post("/ncm/shipments", json=ORDER, headers=AUTH)
    ok = client.get("/ncm/track", params={"ref": "4123456", "phone": ORDER["phone"]})
    assert ok.status_code == 200
    assert ok.json()["ref"] == ORDER["ref"]


def test_track_is_rate_limited(ncm_app) -> None:
    client, _ = ncm_app
    params = {"ref": ORDER["ref"], "phone": ORDER["phone"]}
    codes = [client.get("/ncm/track", params=params).status_code for _ in range(4)]
    assert codes[-1] == 429


def test_api_docs_are_disabled(ncm_app) -> None:
    client, _ = ncm_app
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_not_configured_returns_503(site) -> None:
    with TestClient(create_app(make_settings(site, admin_api_key=ADMIN))) as client:
        assert client.post("/ncm/shipments", json=ORDER, headers=AUTH).status_code == 503


def test_short_secrets_rejected() -> None:
    with pytest.raises(ValueError):
        make_settings(admin_api_key="short")
    with pytest.raises(ValueError):
        make_settings(ncm_webhook_secret="short")


def test_public_url_must_be_https() -> None:
    with pytest.raises(ValueError):
        make_settings(public_base_url="http://giftoyz.com.np")


def _client(handler, **kwargs) -> tuple[NcmClient, list[float], list[dict]]:
    sleeps: list[float] = []
    events: list[dict] = []

    async def sleep(seconds: float) -> None:
        sleeps.append(seconds)

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client = NcmClient(
        http=http, token="tok-123", base_url="https://demo.nepalcanmove.com", sleep=sleep,
        events=lambda **e: events.append(e), **kwargs,
    )
    return client, sleeps, events


async def test_client_sends_token_and_hides_it_in_errors() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers["Authorization"]
        seen["url"] = str(request.url)
        return httpx.Response(400, json={"branch": ["Invalid branch"]})

    client, _, events = _client(handler)
    with pytest.raises(NcmError) as err:
        await client.create_order({"vref_id": "GT-261108-4821"})
    assert seen["auth"] == "Token tok-123"
    assert seen["url"] == "https://demo.nepalcanmove.com/api/v1/order/create"
    assert err.value.message == "branch: Invalid branch"
    assert err.value.code == "NCM_REJECTED"
    assert "tok-123" not in str(events)
    assert events[0]["ref"] == "GT-261108-4821"


async def test_reads_retry_with_backoff() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(503) if calls["n"] < 3 else httpx.Response(200, json=[{"status": "Delivered"}])

    client, sleeps, events = _client(handler, max_retries=3)
    assert await client.order_statuses("4123456") == [{"status": "Delivered"}]
    assert calls["n"] == 3
    assert len(sleeps) == 2 and sleeps[1] > sleeps[0]
    assert [e["code"] for e in events] == ["NCM_BUSY", "NCM_BUSY"]


async def test_create_is_not_repeated_after_server_error() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(502)

    client, _, _ = _client(handler, max_retries=3)
    with pytest.raises(NcmError):
        await client.create_order({"vref_id": "GT-261108-4821"})
    assert calls["n"] == 1


async def test_create_retries_when_connection_never_opened() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ConnectError("refused")
        return httpx.Response(200, json={"orderid": 777})

    client, _, events = _client(handler, max_retries=3)
    assert await client.create_order({"vref_id": "GT-261108-4821"}) == "777"
    assert events[0]["code"] == "NCM_UNREACHABLE"


async def test_create_timeout_is_not_retried() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        raise httpx.ReadTimeout("slow")

    client, _, _ = _client(handler, max_retries=3)
    with pytest.raises(NcmError) as err:
        await client.create_order({"vref_id": "GT-261108-4821"})
    assert err.value.code == "NCM_TIMEOUT"
    assert calls["n"] == 1


def test_client_rejects_other_hosts() -> None:
    with pytest.raises(ValueError):
        NcmClient(http=httpx.AsyncClient(), token="t", base_url="https://evil.example")
