from __future__ import annotations

import json
import re

import pytest

from app.khalti import KhaltiError, Lookup
from tests.conftest import AUTH, WEBHOOK_SECRET, product


def stock(shop, item_id: str = "GFT-TUM-001") -> int:
    products = shop.client.get("/api/admin/products", headers=AUTH).json()["products"]
    return next(p for p in products if p["itemId"] == item_id)["stock"]


# Catalog


def test_catalog_only_lists_visible_products(shop) -> None:
    shop.seed(product(2, visible=False, price=None))
    public = shop.client.get("/api/catalog").json()["products"]
    assert [p["itemId"] for p in public] == ["GFT-TUM-001"]
    admin = shop.client.get("/api/admin/products", headers=AUTH).json()["products"]
    assert len(admin) == 2


@pytest.mark.parametrize(
    "overrides,message",
    [
        ({"itemId": "GFT-PLU-001"}, "must start with GFT-TUM-"),
        ({"visible": True, "price": None}, "needs a price"),
        ({"colors": ["neon"]}, "unknown colours"),
        ({"cat": "weapons"}, "unknown category"),
        ({"slug": "Bad Slug"}, "pattern"),
        ({"images": [{"src": "https://evil.example/x", "w": 1, "h": 1, "kind": "hero", "alt": "bad"}]}, "pattern"),
    ],
)
def test_product_validation(shop, overrides, message) -> None:
    body = product(3, **overrides)
    r = shop.client.put(f"/api/admin/products/{body['itemId']}", json=body, headers=AUTH)
    assert r.status_code == 422
    assert message in r.text


def test_product_write_needs_admin(shop) -> None:
    body = product(4)
    assert shop.client.put(f"/api/admin/products/{body['itemId']}", json=body).status_code == 401


def test_duplicate_slug_or_id_rejected(shop) -> None:
    body = product(5, id=101)
    assert shop.client.put(f"/api/admin/products/{body['itemId']}", json=body, headers=AUTH).status_code == 409


def test_seed_is_idempotent(shop) -> None:
    body = product(1, name="Renamed")
    r = shop.client.put("/api/admin/products/GFT-TUM-001", json=body, headers=AUTH)
    assert r.json()["created"] is False
    assert shop.client.get("/api/catalog").json()["products"][0]["name"] == "Renamed"


# Orders


def test_order_prices_come_from_the_server(shop) -> None:
    r = shop.order()
    assert r.status_code == 200
    order = r.json()["order"]
    assert order["subtotal"] == 1500
    assert order["location"]["fee"] == 200
    assert order["total"] == 1700
    assert order["payment"]["paidNow"] == 200
    assert order["payment"]["due"] == 1500
    assert order["status"] == "payment_pending"
    assert re.fullmatch(r"GT-\d{6}-\d{4}", order["id"])
    assert "phone" not in order and "address" not in order
    assert stock(shop) == 4


def test_client_cannot_send_prices(shop) -> None:
    r = shop.order(items=[{"id": 101, "color": "pink", "qty": 1, "price": 1}])
    assert r.status_code == 422


@pytest.mark.parametrize(
    "overrides,status",
    [
        ({"items": [{"id": 101, "color": "pink", "qty": 6}]}, 409),
        ({"items": [{"id": 999, "color": "pink", "qty": 1}]}, 409),
        ({"items": [{"id": 101, "color": "black", "qty": 1}]}, 422),
        ({"location_key": "MARS"}, 422),
        ({"phone": "123"}, 422),
    ],
)
def test_order_rejections(shop, overrides, status) -> None:
    assert shop.order(**overrides).status_code == status
    assert stock(shop) == 5


def test_hidden_product_cannot_be_ordered(shop) -> None:
    shop.seed(product(1, visible=False))
    assert shop.order().status_code == 409


def test_order_lookup_needs_token(shop) -> None:
    data = shop.order().json()
    oid, token = data["order"]["id"], data["token"]
    assert shop.client.get(f"/api/orders/{oid}", params={"token": token}).status_code == 200
    assert shop.client.get(f"/api/orders/{oid}", params={"token": "x" * 32}).status_code == 404


def test_cancel_restores_stock_and_transitions_are_enforced(shop) -> None:
    oid = shop.order().json()["order"]["id"]
    assert shop.client.post(f"/api/admin/orders/{oid}/status", json={"status": "delivered"}, headers=AUTH).status_code == 409
    assert shop.client.post(f"/api/admin/orders/{oid}/status", json={"status": "cancelled"}, headers=AUTH).status_code == 200
    assert stock(shop) == 5
    assert shop.client.post(f"/api/admin/orders/{oid}/status", json={"status": "confirmed"}, headers=AUTH).status_code == 409


def test_ship_builds_payload_from_stored_order(shop) -> None:
    oid = shop.order(gift={"note": "Happy birthday", "hideSlip": True}).json()["order"]["id"]
    assert shop.client.post(f"/api/admin/orders/{oid}/ship", headers=AUTH).status_code == 409
    shop.client.post(f"/api/admin/orders/{oid}/status", json={"status": "confirmed"}, headers=AUTH)
    r = shop.client.post(f"/api/admin/orders/{oid}/ship", headers=AUTH)
    assert r.status_code == 200
    sent = shop.ncm.created[0]
    assert sent["branch"] == "POKHARA"
    assert sent["fbranch"] == "NEWROAD"
    assert sent["cod_charge"] == "1500"
    assert sent["weight"] == "0.6"
    assert sent["instruction"] == "Receiver: Sita Sharma. Gift parcel. No price slip inside"
    assert r.json()["order"]["status"] == "with_ncm"
    again = shop.client.post(f"/api/admin/orders/{oid}/ship", headers=AUTH)
    assert again.json()["created"] is False
    assert len(shop.ncm.created) == 1


def test_track_by_order_id_and_awb(shop) -> None:
    oid = shop.order().json()["order"]["id"]
    before = shop.client.get("/api/track", params={"q": oid, "phone": "9812345678"}).json()
    assert before["order"]["status"] == "payment_pending"
    assert before["statuses"] == []
    shop.client.post(f"/api/admin/orders/{oid}/status", json={"status": "confirmed"}, headers=AUTH)
    awb = shop.client.post(f"/api/admin/orders/{oid}/ship", headers=AUTH).json()["ncm_id"]
    by_awb = shop.client.get("/api/track", params={"q": awb, "phone": "9812345678"}).json()
    assert by_awb["ref"] == oid
    assert by_awb["order"]["status"] == "in_transit"
    assert by_awb["statuses"][0] == {"status": "Pickup Complete", "at": "2026-11-08 10:00"}
    assert shop.client.get("/api/track", params={"q": oid, "phone": "9800000000"}).status_code == 404


# Khalti


def khalti_order(shop) -> tuple[str, str]:
    data = shop.order(wallet="khalti", txn="").json()
    assert data["khalti"] is True
    return data["order"]["id"], data["token"]


def test_khalti_order_needs_no_txn(shop) -> None:
    oid, _ = khalti_order(shop)
    assert oid.startswith("GT-")


def test_khalti_initiate_uses_server_amount_and_is_reused(shop) -> None:
    oid, token = khalti_order(shop)
    first = shop.client.post("/api/payments/khalti/initiate", json={"order_id": oid, "token": token})
    assert first.status_code == 200
    assert shop.khalti.initiated[0]["amount_paisa"] == 20000
    assert shop.khalti.initiated[0]["return_url"] == "http://localhost:8080/api/payments/khalti/return"
    second = shop.client.post("/api/payments/khalti/initiate", json={"order_id": oid, "token": token})
    assert second.json()["pidx"] == first.json()["pidx"]
    assert len(shop.khalti.initiated) == 1


def test_khalti_initiate_needs_token(shop) -> None:
    oid, _ = khalti_order(shop)
    r = shop.client.post("/api/payments/khalti/initiate", json={"order_id": oid, "token": "x" * 32})
    assert r.status_code == 404


def test_khalti_return_verifies_with_lookup(shop) -> None:
    oid, token = khalti_order(shop)
    pidx = shop.client.post("/api/payments/khalti/initiate", json={"order_id": oid, "token": token}).json()["pidx"]
    pending = shop.client.get("/api/payments/khalti/return", params={"pidx": pidx, "status": "Completed"}, follow_redirects=False)
    assert pending.status_code == 303
    assert pending.headers["location"] == f"/checkout.html?order={oid}&payment=pending"
    shop.khalti.lookups[pidx] = Lookup(pidx=pidx, status="Completed", total_amount=20000, transaction_id="KHTX1")
    done = shop.client.get("/api/payments/khalti/return", params={"pidx": pidx}, follow_redirects=False)
    assert done.headers["location"] == f"/checkout.html?order={oid}&payment=success"
    order = shop.client.get(f"/api/orders/{oid}", params={"token": token}).json()["order"]
    assert order["status"] == "confirmed"
    assert order["payment"]["verified"] is True
    shop.client.get("/api/payments/khalti/return", params={"pidx": pidx}, follow_redirects=False)
    history = shop.client.get(f"/api/orders/{oid}", params={"token": token}).json()["order"]["history"]
    assert [h["status"] for h in history].count("confirmed") == 1


def test_khalti_amount_mismatch_is_rejected(shop) -> None:
    oid, token = khalti_order(shop)
    pidx = shop.client.post("/api/payments/khalti/initiate", json={"order_id": oid, "token": token}).json()["pidx"]
    shop.khalti.lookups[pidx] = Lookup(pidx=pidx, status="Completed", total_amount=100, transaction_id="KHTX1")
    r = shop.client.get("/api/payments/khalti/return", params={"pidx": pidx}, follow_redirects=False)
    assert r.headers["location"].endswith("payment=failed")
    order = shop.client.get(f"/api/orders/{oid}", params={"token": token}).json()["order"]
    assert order["status"] == "payment_pending"


def test_khalti_unknown_pidx_fails_safely(shop) -> None:
    r = shop.client.get("/api/payments/khalti/return", params={"pidx": "unknownPidx1"}, follow_redirects=False)
    assert r.headers["location"] == "/checkout.html?payment=failed"


def test_khalti_paid_order_cannot_be_initiated_again(shop) -> None:
    oid, token = khalti_order(shop)
    pidx = shop.client.post("/api/payments/khalti/initiate", json={"order_id": oid, "token": token}).json()["pidx"]
    shop.khalti.lookups[pidx] = Lookup(pidx=pidx, status="Completed", total_amount=20000, transaction_id="KHTX1")
    shop.client.post("/api/payments/khalti/verify", json={"order_id": oid, "token": token})
    again = shop.client.post("/api/payments/khalti/initiate", json={"order_id": oid, "token": token})
    assert again.status_code == 409


def test_khalti_error_is_reported(shop) -> None:
    oid, token = khalti_order(shop)
    shop.khalti.fail = KhaltiError("Khalti is not reachable right now", 503)
    r = shop.client.post("/api/payments/khalti/initiate", json={"order_id": oid, "token": token})
    assert r.status_code == 503


# NCM webhook


def shipped(shop) -> tuple[str, str]:
    oid = shop.order().json()["order"]["id"]
    shop.client.post(f"/api/admin/orders/{oid}/status", json={"status": "confirmed"}, headers=AUTH)
    return oid, shop.client.post(f"/api/admin/orders/{oid}/ship", headers=AUTH).json()["ncm_id"]


def test_webhook_needs_secret(shop) -> None:
    _, awb = shipped(shop)
    r = shop.client.post("/api/ncm/webhook", params={"token": "nope"}, json={"order_id": awb, "status": "Delivered"})
    assert r.status_code == 401


def test_webhook_verifies_with_ncm_and_dedupes(shop) -> None:
    oid, awb = shipped(shop)
    shop.ncm.statuses = [{"status": "Delivered", "added_time": "2026-11-09 12:00"}]
    body = json.dumps({"order_id": awb, "status": "Delivered"})
    first = shop.client.post("/api/ncm/webhook", params={"token": WEBHOOK_SECRET}, content=body)
    assert first.json() == {"status": "ok"}
    second = shop.client.post("/api/ncm/webhook", params={"token": WEBHOOK_SECRET}, content=body)
    assert second.json() == {"status": "duplicate"}
    order = shop.client.get("/api/admin/orders", headers=AUTH).json()["orders"][0]
    assert order["status"] == "delivered"
    assert order["ncm"]["status"] == "Delivered"


def test_webhook_does_not_trust_payload_status(shop) -> None:
    _, awb = shipped(shop)
    shop.ncm.statuses = [{"status": "Pickup Complete"}]
    shop.client.post("/api/ncm/webhook", params={"token": WEBHOOK_SECRET}, json={"order_id": awb, "status": "Delivered"})
    order = shop.client.get("/api/admin/orders", headers=AUTH).json()["orders"][0]
    assert order["status"] == "in_transit"


def test_ncm_events_listed_for_admin(shop) -> None:
    assert shop.client.get("/api/admin/ncm/events", headers=AUTH).json() == {"events": []}
    assert shop.client.get("/api/admin/ncm/events").status_code == 401


# Pages, SEO and static files


def test_product_page_has_meta_and_json_ld(shop) -> None:
    r = shop.client.get("/product.html", params={"item": "GFT-TUM-001"})
    assert r.status_code == 200
    html = r.text
    assert "<title>Test Tumbler 1 | GifToyz Nepal</title>" in html
    assert '<link rel="canonical" href="http://localhost:8080/product.html?item=GFT-TUM-001">' in html
    assert '<meta property="og:type" content="product">' in html
    assert 'og:image" content="http://localhost:8080/media/products/test-tumbler-1-1-1200.jpg"' in html
    blocks = [json.loads(b) for b in re.findall(r'<script[^>]*type="application/ld\+json">(.*?)</script>', html)]
    types = [b["@type"] for b in blocks]
    assert types == ["Product", "BreadcrumbList"]
    assert blocks[0]["offers"]["price"] == "1500"
    assert "window.GT_CATALOG=" in html and html.index("GT_CATALOG") < html.index('src="data.js')


def test_unknown_product_is_404_noindex(shop) -> None:
    r = shop.client.get("/product.html", params={"item": "GFT-TUM-999"})
    assert r.status_code == 404
    assert '<meta name="robots" content="noindex">' in r.text


def test_category_and_home_meta(shop) -> None:
    cat = shop.client.get("/products.html", params={"cat": "tumblers"}).text
    assert "<title>Tumblers | GifToyz Nepal</title>" in cat
    home = shop.client.get("/").text
    assert '"@type":"Store"' in home
    assert home.count("application/ld+json") == 1


def test_injected_json_cannot_break_out_of_script(shop) -> None:
    shop.seed(product(1, name="Evil </script><script>alert(1)</script>"))
    html = shop.client.get("/").text
    assert "</script><script>alert(1)" not in html


def test_sitemap_and_robots(shop) -> None:
    shop.seed(product(2, visible=False, price=None))
    xml = shop.client.get("/sitemap.xml").text
    assert "product.html?item=GFT-TUM-001" in xml
    assert "GFT-TUM-002" not in xml
    assert "products.html?cat=tumblers" in xml
    robots = shop.client.get("/robots.txt").text
    assert "Disallow: /admin.html" in robots
    assert "Sitemap: http://localhost:8080/sitemap.xml" in robots


def test_serves_site_pages_and_media(shop) -> None:
    assert shop.client.get("/app.js").text == "js"
    assert shop.client.get("/app.js", params={"v": "1"}).headers["Cache-Control"].endswith("immutable")
    assert shop.client.get("/admin.html").headers["X-Robots-Tag"] == "noindex, nofollow"
    media = shop.client.get("/media/products/test-tumbler-1-1-600.webp")
    assert media.status_code == 200
    assert "immutable" in media.headers["Cache-Control"]


@pytest.mark.parametrize(
    "path",
    [
        "/.env",
        "/server/.env",
        "/server/app/config.py",
        "/build/pages.py",
        "/..%2Foutside.html",
        "/%2e%2e/outside.html",
        "/data.sqlite3",
        "/missing.html",
        "/media/products/../../server/.env",
        "/media/products/x.heic",
    ],
)
def test_never_serves_private_files(shop, path) -> None:
    response = shop.client.get(path)
    assert response.status_code == 404
    assert "secret" not in response.text


# Photo uploads


def _photo(fmt: str, size: tuple[int, int] = (900, 1600)) -> bytes:
    import io

    import pillow_heif
    from PIL import Image

    pillow_heif.register_heif_opener()
    buf = io.BytesIO()
    Image.new("RGB", size, (240, 120, 160)).save(buf, format=fmt)
    return buf.getvalue()


def test_heic_upload_is_converted(shop, site) -> None:
    r = shop.client.post("/api/admin/media", params={"alt": "Pink tumbler"}, content=_photo("HEIF"), headers=AUTH)
    assert r.status_code == 200, r.text
    image = r.json()["image"]
    assert image["src"].startswith("/media/products/u-")
    assert (image["w"], image["h"]) == (900, 1600)
    stem = image["src"].rsplit("/", 1)[1]
    for w in (600, 1200):
        for ext in ("avif", "webp", "jpg"):
            assert (site / "media" / "products" / f"{stem}-{w}.{ext}").is_file()
    assert shop.client.get(f"{image['src']}-600.avif").status_code == 200
    body = product(1, images=[image])
    assert shop.client.put("/api/admin/products/GFT-TUM-001", json=body, headers=AUTH).status_code == 200


def test_jpeg_upload_works(shop) -> None:
    r = shop.client.post("/api/admin/media", content=_photo("JPEG"), headers=AUTH)
    assert r.status_code == 200
    assert r.json()["image"]["alt"] == "Product photo"


@pytest.mark.parametrize("content,status", [(b"not an image", 422), (b"", 422)])
def test_bad_uploads_rejected(shop, content, status) -> None:
    assert shop.client.post("/api/admin/media", content=content, headers=AUTH).status_code == status


def test_tiny_photo_rejected(shop) -> None:
    r = shop.client.post("/api/admin/media", content=_photo("PNG", (120, 120)), headers=AUTH)
    assert r.status_code == 422
    assert "too small" in r.text


def test_upload_needs_admin(shop) -> None:
    assert shop.client.post("/api/admin/media", content=_photo("JPEG")).status_code == 401


def test_oversized_upload_rejected(shop) -> None:
    headers = {**AUTH, "Content-Length": str(30 * 1024 * 1024)}
    assert shop.client.post("/api/admin/media", content=b"x", headers=headers).status_code in (413, 400)


# Shop settings


def test_settings_reach_customer_pages(shop) -> None:
    current = shop.client.get("/api/admin/settings", headers=AUTH).json()["settings"]
    body = {**current, "announce_en": "Dashain sale, 10% off", "announce_ne": "दशैं सेल"}
    assert shop.client.put("/api/admin/settings", json=body).status_code == 401
    assert shop.client.put("/api/admin/settings", json=body, headers=AUTH).status_code == 200
    assert shop.client.get("/api/settings").json()["settings"]["announce_en"] == "Dashain sale, 10% off"
    html = shop.client.get("/").text
    assert "window.GT_SETTINGS=" in html and "Dashain sale, 10% off" in html


@pytest.mark.parametrize("field,value", [("whatsapp", "12345"), ("instagram", "bad name!"), ("lowStock", -1), ("announce_en", "x" * 200)])
def test_settings_validation(shop, field, value) -> None:
    current = shop.client.get("/api/admin/settings", headers=AUTH).json()["settings"]
    assert shop.client.put("/api/admin/settings", json={**current, field: value}, headers=AUTH).status_code == 422


def test_cod_advance_setting_controls_pay_now(shop) -> None:
    current = shop.client.get("/api/admin/settings", headers=AUTH).json()["settings"]
    shop.client.put("/api/admin/settings", json={**current, "codAdvance": False}, headers=AUTH)
    order = shop.order(txn="").json()["order"]
    assert order["payment"]["paidNow"] == 0
    assert order["status"] == "received"


def test_qr_upload_and_setting(shop) -> None:
    r = shop.client.post("/api/admin/media", params={"kind": "qr"}, content=_photo("PNG", (400, 400)), headers=AUTH)
    assert r.status_code == 200, r.text
    src = r.json()["src"]
    assert shop.client.get(src).headers["content-type"] == "image/png"
    current = shop.client.get("/api/admin/settings", headers=AUTH).json()["settings"]
    saved = shop.client.put("/api/admin/settings", json={**current, "qr": {"esewa": src}}, headers=AUTH)
    assert saved.json()["settings"]["qr"]["esewa"] == src
    bad = shop.client.put("/api/admin/settings", json={**current, "qr": {"esewa": "https://evil.example/qr.png"}}, headers=AUTH)
    assert bad.status_code == 422


# NCM status sync


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Delivered", "delivered"),
        ("Order Delivered to customer", "delivered"),
        ("Sent for Delivery", "in_transit"),
        ("Out for delivery", "in_transit"),
        ("Pickup Complete", "in_transit"),
        ("Arrived at Pokhara branch", "in_transit"),
        ("Pickup Order Created", None),
        ("Undelivered", None),
        ("Not delivered, customer unreachable", None),
        ("Returned to vendor", None),
        ("Return delivered to vendor", None),
    ],
)
def test_ncm_status_text(text, expected) -> None:
    from app.orders import ncm_to_status

    assert ncm_to_status(text) == expected


def test_latest_status_uses_time() -> None:
    from app.orders import latest_status

    statuses = [
        {"status": "Pickup Complete", "at": "2026-11-08 10:00:00"},
        {"status": "Delivered", "at": "2026-11-09 15:30:00"},
        {"status": "Sent for Delivery", "at": "2026-11-09 09:00:00"},
    ]
    assert latest_status(statuses) == "Delivered"


async def test_background_check_updates_orders(shop) -> None:
    import asyncio

    from app.orders import poll_ncm

    oid, _ = shipped(shop)
    shop.ncm.statuses = [{"status": "Delivered", "added_time": "2026-11-09 15:30:00"}]
    app = shop.client.app
    task = asyncio.create_task(poll_ncm(app.state.ctx, app.state.ncm, interval=0, pause=0))
    await asyncio.sleep(0.05)
    task.cancel()
    order = shop.client.get("/api/admin/orders", headers=AUTH).json()["orders"][0]
    assert order["id"] == oid
    assert order["status"] == "delivered"
    assert [h["status"] for h in order["history"]][-2:] == ["in_transit", "delivered"]


def test_tracking_lookup_also_syncs_status(shop) -> None:
    oid, awb = shipped(shop)
    shop.ncm.statuses = [{"status": "Sent for Delivery", "added_time": "2026-11-09 09:00:00"}]
    data = shop.client.get("/api/track", params={"q": oid, "phone": "9812345678"}).json()
    assert data["statuses"][0]["status"] == "Sent for Delivery"
    assert data["order"]["status"] == "in_transit"
    order = shop.client.get("/api/admin/orders", headers=AUTH).json()["orders"][0]
    assert order["status"] == "in_transit"


# Categories, colours, occasions


def taxonomy(shop) -> dict:
    return shop.client.get("/api/taxonomy").json()["taxonomy"]


def test_rename_category_and_add_colour(shop) -> None:
    tax = taxonomy(shop)
    tax["categories"][0]["en"] = "Steel tumblers"
    tax["colors"].append({"id": "gold", "en": "Gold", "ne": "सुनौलो", "hex": "#D4AF37"})
    tax["occasions"].append({"id": "dashain", "en": "Dashain", "ne": "दशैं"})
    assert shop.client.put("/api/admin/taxonomy", json=tax).status_code == 401
    r = shop.client.put("/api/admin/taxonomy", json=tax, headers=AUTH)
    assert r.status_code == 200, r.text
    assert shop.seed(product(1, colors=["gold"], occasions=["dashain"])) is None
    html = shop.client.get("/products.html", params={"cat": "tumblers"}).text
    assert "<title>Steel tumblers | GifToyz Nepal</title>" in html
    assert "window.GT_TAXONOMY=" in html


def test_new_category_gets_its_own_item_code(shop) -> None:
    tax = taxonomy(shop)
    tax["categories"].append({"id": "keychains", "en": "Keychains", "ne": "किचेन", "code": "KEY", "art": "giftbox"})
    shop.client.put("/api/admin/taxonomy", json=tax, headers=AUTH)
    body = product(7, itemId="GFT-KEY-001", cat="keychains", slug="kitty-keychain", id=301)
    assert shop.client.put("/api/admin/products/GFT-KEY-001", json=body, headers=AUTH).status_code == 200


def test_cannot_remove_category_in_use(shop) -> None:
    tax = taxonomy(shop)
    tax["categories"] = [c for c in tax["categories"] if c["id"] != "tumblers"]
    r = shop.client.put("/api/admin/taxonomy", json=tax, headers=AUTH)
    assert r.status_code == 409
    assert "tumblers" in r.json()["detail"]


def test_cannot_change_item_code_in_use(shop) -> None:
    tax = taxonomy(shop)
    tax["categories"][0]["code"] = "TMB"
    assert shop.client.put("/api/admin/taxonomy", json=tax, headers=AUTH).status_code == 409


@pytest.mark.parametrize(
    "change",
    [
        lambda t: t["colors"].append({"id": "pink", "en": "Pink again", "hex": "#FF00FF"}),
        lambda t: t["colors"].append({"id": "x", "en": "Bad", "hex": "pink"}),
        lambda t: t["categories"].append({"id": "x", "en": "X", "code": "TUM"}),
        lambda t: t["categories"].append({"id": "Bad Id", "en": "X", "code": "XXX"}),
    ],
)
def test_taxonomy_validation(shop, change) -> None:
    tax = taxonomy(shop)
    change(tax)
    assert shop.client.put("/api/admin/taxonomy", json=tax, headers=AUTH).status_code == 422


def test_product_with_unknown_colour_rejected(shop) -> None:
    body = product(1, colors=["neon"])
    r = shop.client.put("/api/admin/products/GFT-TUM-001", json=body, headers=AUTH)
    assert r.status_code == 422


# Pausing orders and socials


def test_paused_shop_refuses_orders(shop) -> None:
    current = shop.client.get("/api/admin/settings", headers=AUTH).json()["settings"]
    shop.client.put("/api/admin/settings", json={**current, "orders_paused": True}, headers=AUTH)
    r = shop.order()
    assert r.status_code == 503
    assert "break" in r.json()["detail"]


def test_tiktok_in_store_schema(shop) -> None:
    html = shop.client.get("/").text
    assert "https://www.tiktok.com/@giftoyz.np" in html


# Home page banners


def _banner(shop, size=(2400, 800)) -> dict:
    r = shop.client.post("/api/admin/media", params={"kind": "banner"}, content=_photo("JPEG", size), headers=AUTH)
    assert r.status_code == 200, r.text
    return r.json()["image"]


def _save_banners(shop, banners, **extra):
    current = shop.client.get("/api/admin/settings", headers=AUTH).json()["settings"]
    return shop.client.put("/api/admin/settings", json={**current, "banners": banners, **extra}, headers=AUTH)


def test_banner_upload_makes_wide_variants(shop, site) -> None:
    image = _banner(shop)
    assert (image["w"], image["h"]) == (2400, 800)
    stem = image["src"].rsplit("/", 1)[1]
    for w in (800, 1600, 2400):
        assert (site / "media" / "products" / f"{stem}-{w}.avif").is_file()
    assert shop.client.get(f"{image['src']}-1600.webp").status_code == 200


def test_banners_show_on_home_page_by_date(shop) -> None:
    image = _banner(shop)
    banners = [
        {"id": "aaaaaaaa", "image": image, "title_en": "Happy Dashain", "link": "products.html?cat=tumblers"},
        {"id": "bbbbbbbb", "image": image, "title_en": "Future sale", "starts": "2099-01-01"},
        {"id": "cccccccc", "image": image, "title_en": "Old sale", "ends": "2000-01-01"},
        {"id": "dddddddd", "image": image, "title_en": "Switched off", "active": False},
    ]
    assert _save_banners(shop, banners).status_code == 200
    public = shop.client.get("/api/settings").json()["settings"]["banners"]
    assert [b["title_en"] for b in public] == ["Happy Dashain"]
    html = shop.client.get("/").text
    assert "Happy Dashain" in html and "Future sale" not in html
    admin = shop.client.get("/api/admin/settings", headers=AUTH).json()["settings"]["banners"]
    assert len(admin) == 4


@pytest.mark.parametrize(
    "change",
    [
        {"link": "javascript:alert(1)"},
        {"link": "http://evil.example"},
        {"link": "/x\" onmouseover=\"alert(1)"},
        {"starts": "next week"},
        {"image": {"src": "https://evil.example/x", "w": 10, "h": 10}},
    ],
)
def test_banner_validation(shop, change) -> None:
    image = _banner(shop)
    banner = {"id": "aaaaaaaa", "image": image, **change}
    assert _save_banners(shop, [banner]).status_code == 422


def test_at_most_eight_banners(shop) -> None:
    image = _banner(shop)
    banners = [{"id": f"{i:08x}", "image": image} for i in range(9)]
    assert _save_banners(shop, banners).status_code == 422


def test_main_banner_switch_hides_all(shop) -> None:
    image = _banner(shop)
    _save_banners(shop, [{"id": "aaaaaaaa", "image": image, "title_en": "Happy Tihar"}], banners_enabled=False)
    assert shop.client.get("/api/settings").json()["settings"]["banners"] == []
    assert "Happy Tihar" not in shop.client.get("/").text
    admin = shop.client.get("/api/admin/settings", headers=AUTH).json()["settings"]
    assert admin["banners_enabled"] is False and len(admin["banners"]) == 1
    _save_banners(shop, admin["banners"], banners_enabled=True)
    assert "Happy Tihar" in shop.client.get("/").text


# Bills


def test_customer_can_open_bill_with_token(shop) -> None:
    data = shop.order().json()
    oid, token = data["order"]["id"], data["token"]
    r = shop.client.get(f"/invoice/{oid}", params={"token": token})
    assert r.status_code == 200
    html = r.text
    assert oid in html and "Sita Sharma" in html and "Rs 1,700" in html and "Pay on delivery" in html
    assert r.headers["Cache-Control"] == "no-store"
    assert shop.client.get(f"/invoice/{oid}", params={"token": "x" * 32}).status_code == 404


def test_bill_escapes_customer_text(shop) -> None:
    data = shop.order(name="<script>alert(1)</script>", address="Lakeside <b>road</b> chowk").json()
    html = shop.client.get(f"/invoice/{data['order']['id']}", params={"token": data["token"]}).text
    assert "<script>alert(1)" not in html and "&lt;b&gt;road" in html


# NCM prices


async def test_price_refresh_updates_fees_and_records_changes(shop) -> None:
    from app.rates import sync_rates

    shop.ncm.prices = {"TINKUNE": (120, 70), "NEWROAD": (120, 70)}
    shop.ncm.rate_fail = {"POKHARA"}
    ctx = shop.client.app.state.ctx
    summary = await sync_rates(ctx.rates, shop.ncm, "NEWROAD")
    assert summary["updated"] == 2 and summary["failed"] == ["POKHARA"]
    assert {c["key"] for c in summary["changed"]} == {"TINKUNE", "NEWROAD"}
    assert ctx.rates.get("TINKUNE").home == 120 and ctx.rates.get("TINKUNE").branch == 70
    assert ctx.rates.get("POKHARA").home == 200
    r = shop.order(location_key="TINKUNE", delivery="branch").json()["order"]
    assert r["location"]["fee"] == 70
    assert '"TINKUNE":[120,70]' in shop.client.get("/").text


def test_admin_price_refresh_endpoint(shop) -> None:
    import time

    shop.ncm.prices = {"POKHARA": (180, 130)}
    assert shop.client.post("/api/admin/rates/sync").status_code == 401
    r = shop.client.post("/api/admin/rates/sync", headers=AUTH)
    assert r.status_code == 202
    for _ in range(50):
        data = shop.client.get("/api/admin/rates", headers=AUTH).json()
        if not data["running"] and data["last_sync"]:
            break
        time.sleep(0.05)
    assert data["last_sync"]["updated"] == 3
    assert next(x for x in data["rates"] if x["key"] == "POKHARA")["home"] == 180


def test_ncm_timeline_saved_with_branch_contact(shop) -> None:
    oid, awb = shipped(shop)
    shop.ncm.statuses = [
        {"status": "Pickup Complete", "added_time": "2026-11-09 10:00:00"},
        {"status": "Arrived at Pokhara branch", "added_time": "2026-11-10 08:00:00"},
    ]
    data = shop.client.get("/api/track", params={"q": oid, "phone": "9812345678"}).json()
    assert data["statuses"][0]["status"] == "Arrived at Pokhara branch"
    admin = shop.client.get(f"/ncm/shipments/{oid}", headers=AUTH).json()
    assert admin["comments"][0]["comments"].startswith("Customer asked")
    order = shop.client.get("/api/admin/orders", headers=AUTH).json()["orders"][0]
    assert [t["status"] for t in order["ncm"]["timeline"]] == ["Arrived at Pokhara branch", "Pickup Complete"]


async def test_background_check_saves_branch_phone(shop) -> None:
    import asyncio

    from app.orders import poll_ncm

    oid, _ = shipped(shop)
    app = shop.client.app
    task = asyncio.create_task(poll_ncm(app.state.ctx, app.state.ncm, interval=0, pause=0))
    await asyncio.sleep(0.05)
    task.cancel()
    data = shop.client.get("/api/track", params={"q": oid, "phone": "9812345678"}).json()
    assert data["branch"] == {"name": "POKHARA", "phone": "061-555555"}



def test_ncm_branch_names_used_for_shipping(shop) -> None:
    ctx = shop.client.app.state.ctx
    with ctx.db.tx() as conn:
        conn.execute("INSERT INTO rates (key, home, branch, source, updated_ts, ncm_name) VALUES ('CHITWAN', 200, 150, 'card', 0, 'NARAYANGHAT')")
    ctx.rates._cache = ctx.rates._names = None
    oid = shop.order(location_key="CHITWAN").json()["order"]["id"]
    shop.client.post(f"/api/admin/orders/{oid}/status", json={"status": "confirmed"}, headers=AUTH)
    shop.client.post(f"/api/admin/orders/{oid}/ship", headers=AUTH)
    assert shop.ncm.created[-1]["branch"] == "NARAYANGHAT"


async def test_price_refresh_uses_ncm_branch_name(shop) -> None:
    from app.rates import sync_rates

    ctx = shop.client.app.state.ctx
    with ctx.db.tx() as conn:
        conn.execute("UPDATE rates SET ncm_name = 'POKHARA BRANCH' WHERE key = 'POKHARA'")
    ctx.rates._names = None
    shop.ncm.prices = {"POKHARA BRANCH": (190, 140)}
    summary = await sync_rates(ctx.rates, shop.ncm, "NEWROAD", only=["POKHARA"])
    assert summary["updated"] == 1
    assert ctx.rates.get("POKHARA").home == 190



def test_manual_payment_needs_no_transaction_id(shop) -> None:
    order = shop.order(txn="").json()["order"]
    assert order["status"] == "payment_pending" and order["payment"]["paidNow"] == 200


def test_payment_account_details_saved(shop) -> None:
    current = shop.client.get("/api/admin/settings", headers=AUTH).json()["settings"]
    info = {"esewa": {"name": "Test Person", "number": "9800000000"}, "bank": {"name": "TEST NAME", "number": "0020701000001", "bank": "Global IME Bank"}}
    r = shop.client.put("/api/admin/settings", json={**current, "qr_info": info}, headers=AUTH)
    assert r.status_code == 200
    assert shop.client.get("/api/settings").json()["settings"]["qr_info"]["bank"]["bank"] == "Global IME Bank"
    bad = shop.client.put("/api/admin/settings", json={**current, "qr_info": {"esewa": {"number": "<script>"}}}, headers=AUTH)
    assert bad.status_code == 422



# Security headers


def test_pages_have_strict_script_policy(shop) -> None:
    r = shop.client.get("/")
    policy = r.headers["Content-Security-Policy"]
    nonce = policy.split("'nonce-")[1].split("'")[0]
    assert "script-src 'self' 'nonce-" in policy and "frame-ancestors 'none'" in policy and "unsafe-eval" not in policy
    assert r.text.count("<script") == r.text.count(f'<script nonce="{nonce}"')
    assert shop.client.get("/").headers["Content-Security-Policy"] != policy


def test_bill_has_policy_and_no_inline_handlers(shop) -> None:
    data = shop.order().json()
    r = shop.client.get(f"/invoice/{data['order']['id']}", params={"token": data["token"]})
    assert "Content-Security-Policy" in r.headers and "onclick" not in r.text


def test_proxy_address_only_used_when_trusted(shop) -> None:
    codes = [shop.client.get("/api/track", params={"q": "GT-261108-0000", "phone": "9812345678"}, headers={"X-Forwarded-For": f"10.0.0.{i}"}).status_code for i in range(60)]
    assert 429 in codes


def test_oversized_request_refused(shop) -> None:
    r = shop.client.post("/api/orders", content=b"{}", headers={"Content-Length": str(27 * 1024 * 1024), "Content-Type": "application/json"})
    assert r.status_code in (413, 400)



def test_every_page_has_a_share_image(shop) -> None:
    for path in ("/", "/products.html", "/checkout.html"):
        html = shop.client.get(path).text
        assert '<meta property="og:image" content="http://localhost:8080/about-cover-1024.jpg">' in html, path
    home = shop.client.get("/").text
    assert '"addressLocality":"Kathmandu"' in home and "icon-512.png" in home
