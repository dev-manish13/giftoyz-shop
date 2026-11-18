"""Build product images and publish the catalog through the admin API.

Usage: .venv/bin/python seed_catalog.py [--photos DIR] [--base URL] [--images-only] [--force]
Prices, stock and visibility come from catalog/prices.csv. A product is only made visible when it has a price.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SITE = HERE.parent
MEDIA = SITE / "media" / "products"


def read_env() -> dict[str, str]:
    env: dict[str, str] = {}
    path = HERE / ".env"
    if path.exists():
        for line in path.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, _, value = line.partition("=")
                env[key.strip()] = value.strip().strip('"').strip("'")
    return {**env, **{k: v for k, v in os.environ.items() if k in ("ADMIN_API_KEY", "PUBLIC_BASE_URL")}}


def build_images(products: list[dict], photos: Path, force: bool) -> None:
    from app.images import QUALITY, WIDTHS, open_image, write_variants

    for p in products:
        images = []
        for n, photo in enumerate(p.pop("photos"), start=1):
            stem = f"{p['slug']}-{n}"
            source = photos / photo["file"]
            outputs = [MEDIA / f"{stem}-{w}.{ext}" for w in WIDTHS for ext in QUALITY]
            if force or not all(o.exists() and o.stat().st_mtime >= source.stat().st_mtime for o in outputs):
                write_variants(open_image(source), MEDIA, stem, crop=True, focus=float(photo.get("focus", 0.5)))
                print(f"  {stem}: built from {photo['file']}")
            images.append({
                "src": f"/media/products/{stem}",
                "w": WIDTHS[-1],
                "h": WIDTHS[-1] * 5 // 4,
                "kind": photo["kind"],
                "alt": photo["alt"],
                "formats": list(QUALITY),
                "widths": list(WIDTHS),
            })
        p["images"] = images


def apply_prices(products: list[dict], path: Path) -> None:
    rows = {r["item_id"].strip(): r for r in csv.DictReader(path.open())} if path.exists() else {}
    for p in products:
        row = rows.get(p["itemId"], {})
        price = (row.get("price") or "").strip()
        compare = (row.get("compare") or "").strip()
        p["price"] = int(price) if price else None
        p["compare"] = int(compare) if compare else 0
        p["stock"] = int((row.get("stock") or "0").strip() or 0)
        p["visible"] = (row.get("visible") or "").strip().lower() in ("yes", "true", "1") and p["price"] is not None


def publish(products: list[dict], base: str, key: str) -> int:
    failures = 0
    for p in products:
        request = urllib.request.Request(
            f"{base}/api/admin/products/{p['itemId']}",
            data=json.dumps(p).encode(),
            method="PUT",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                created = json.loads(response.read())["created"]
            state = "visible" if p["visible"] else "draft (no price)" if p["price"] is None else "hidden"
            print(f"  {p['itemId']} {'created' if created else 'updated'}: {p['name']} [{state}]")
        except urllib.error.HTTPError as exc:
            failures += 1
            print(f"  {p['itemId']} FAILED {exc.code}: {exc.read().decode()[:300]}", file=sys.stderr)
        except urllib.error.URLError as exc:
            print(f"Can't reach {base}: {exc.reason}. Is server/run.sh running?", file=sys.stderr)
            return len(products)
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--photos", default=str(SITE.parent / "giftoyz-products"))
    parser.add_argument("--base")
    parser.add_argument("--prices", default=str(HERE / "catalog" / "prices.csv"))
    parser.add_argument("--images-only", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    env = read_env()
    products = json.loads((HERE / "catalog" / "products.json").read_text())
    print(f"Building images for {len(products)} products")
    build_images(products, Path(args.photos), args.force)
    if args.images_only:
        return 0
    apply_prices(products, Path(args.prices))
    key = env.get("ADMIN_API_KEY", "")
    if len(key) < 32:
        print("ADMIN_API_KEY is missing from server/.env", file=sys.stderr)
        return 1
    base = (args.base or env.get("PUBLIC_BASE_URL") or "http://localhost:8080").rstrip("/")
    print(f"Publishing to {base}")
    failures = publish(products, base, key)
    print("Done" if not failures else f"{failures} product(s) failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
