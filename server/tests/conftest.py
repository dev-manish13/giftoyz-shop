from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.client import NcmError
from app.config import Settings
from app.khalti import Initiated, KhaltiError, Lookup
from app.main import create_app

ADMIN = "a" * 40
AUTH = {"Authorization": f"Bearer {ADMIN}"}
WEBHOOK_SECRET = "w" * 40

DATA_JS = """window.GT_DATA = (() => {
  const ncmRows = `TINKUNE|170|120
POKHARA|200|150
NEWROAD|170|120`;
  return {};
})();
"""

PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<meta name="description" content="Default description">
<script type="application/ld+json">{{"@type":"Store"}}</script>
</head>
<body>
<script src="data.js?v=1"></script>
<script src="app.js?v=1"></script>
</body>
</html>
"""


def product(num: int = 1, **overrides: Any) -> dict[str, Any]:
    data = {
        "itemId": f"GFT-TUM-{num:03d}",
        "id": 100 + num,
        "slug": f"test-tumbler-{num}",
        "name": f"Test Tumbler {num}",
        "ne_name": "टम्बलर",
        "cat": "tumblers",
        "art": "tumbler",
        "price": 1500,
        "stock": 5,
        "colors": ["pink"],
        "blurb": "A pink tumbler.",
        "images": [{"src": f"/media/products/test-tumbler-{num}-1", "w": 1200, "h": 1500, "kind": "hero", "alt": "Pink tumbler"}],
        "weight_kg": 0.6,
        "visible": True,
    }
    data.update(overrides)
    return data


def make_settings(site: Path | None = None, **overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "database_path": ":memory:",
        "ncm_api_token": None,
        "admin_api_key": None,
        "ncm_pickup_branch": "",
        "khalti_secret_key": None,
        "public_base_url": "http://localhost:8080",
    }
    if site is not None:
        values["site_dir"] = str(site)
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.fixture
def site(tmp_path: Path) -> Path:
    root = tmp_path / "site"
    (root / "server").mkdir(parents=True)
    (root / "build").mkdir()
    (root / "media" / "products").mkdir(parents=True)
    (root / "data.js").write_text(DATA_JS)
    for name, title in [("index.html", "GifToyz Nepal"), ("product.html", "Product | GifToyz Nepal"), ("products.html", "Shop | GifToyz Nepal"), ("admin.html", "Admin"), ("checkout.html", "Checkout")]:
        (root / name).write_text(PAGE.format(title=title))
    (root / "app.js").write_text("js")
    (root / ".env").write_text("NCM_API_TOKEN=secret")
    (root / "server" / ".env").write_text("NCM_API_TOKEN=secret")
    (root / "build" / "pages.py").write_text("x")
    (root / "media" / "products" / "test-tumbler-1-1-600.webp").write_bytes(b"RIFF")
    (tmp_path / "outside.html").write_text("outside")
    return root


class FakeNcm:
    def __init__(self) -> None:
        self.created: list[dict] = []
        self.fail: NcmError | None = None
        self.statuses: list[dict] = [{"status": "Pickup Complete", "added_time": "2026-11-08 10:00", "vendor_note": "secret"}]

    async def create_order(self, payload: dict) -> str:
        if self.fail:
            raise self.fail
        self.created.append(payload)
        return str(4123456 + len(self.created) - 1)

    async def order_details(self, ncm_id: str) -> dict:
        return {"orderid": ncm_id, "destination_branch_name": "POKHARA", "destination_branch_phone": "061-555555", "trackid": "TRK" + ncm_id}

    async def order_statuses(self, ncm_id: str) -> list[dict]:
        return self.statuses

    async def set_webhook(self, url: str) -> None:
        self.webhook = url

    async def shipping_rate(self, origin: str, destination: str, kind: str) -> int:
        self.rate_calls = getattr(self, "rate_calls", 0) + 1
        if destination in getattr(self, "rate_fail", set()):
            raise NcmError("down", 503, "NCM_UNREACHABLE")
        prices = getattr(self, "prices", {})
        home, branch = prices.get(destination, (170, 120))
        return home if kind == "Pickup/Collect" else branch

    async def order_comments(self, ncm_id: str) -> list[dict]:
        return [{"comments": "Customer asked to call before delivery", "addedBy": "NCM"}]


class FakeKhalti:
    def __init__(self) -> None:
        self.initiated: list[dict] = []
        self.lookups: dict[str, Lookup] = {}
        self.fail: KhaltiError | None = None

    async def initiate(self, **kwargs: Any) -> Initiated:
        if self.fail:
            raise self.fail
        self.initiated.append(kwargs)
        pidx = f"pidx{len(self.initiated)}AAAA"
        return Initiated(pidx=pidx, payment_url=f"https://test-pay.khalti.com/?pidx={pidx}", expires_at="2099-01-01T00:00:00+05:45")

    async def lookup(self, pidx: str) -> Lookup:
        return self.lookups.get(pidx, Lookup(pidx=pidx, status="Pending", total_amount=0, transaction_id=""))


class Shop:
    def __init__(self, client: TestClient, ncm: FakeNcm, khalti: FakeKhalti) -> None:
        self.client = client
        self.ncm = ncm
        self.khalti = khalti

    def seed(self, *products: dict[str, Any]) -> None:
        for p in products:
            r = self.client.put(f"/api/admin/products/{p['itemId']}", json=p, headers=AUTH)
            assert r.status_code == 200, r.text

    def order(self, **overrides: Any) -> Any:
        body = {
            "items": [{"id": 101, "color": "pink", "qty": 1}],
            "name": "Sita Sharma",
            "phone": "9812345678",
            "location_key": "POKHARA",
            "delivery": "home",
            "address": "Near the main chowk",
            "mode": "cod",
            "wallet": "esewa",
            "txn": "TX123456",
        }
        body.update(overrides)
        return self.client.post("/api/orders", json=body)


@pytest.fixture
def shop(site: Path):
    ncm, khalti = FakeNcm(), FakeKhalti()
    settings = make_settings(
        site,
        admin_api_key=ADMIN,
        ncm_pickup_branch="newroad",
        ncm_webhook_secret=WEBHOOK_SECRET,
        order_limit_per_minute=50,
        track_limit_per_minute=50,
    )
    with TestClient(create_app(settings, ncm_client=ncm, khalti_client=khalti)) as client:
        instance = Shop(client, ncm, khalti)
        instance.seed(product(1))
        yield instance
