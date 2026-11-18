from __future__ import annotations

import json
import secrets
from pathlib import Path as FsPath
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .db import Database, dumps
from .images import WIDTHS, ImageError, open_image, write_qr, write_variants
from .routes import clean, require_admin

MAX_UPLOAD = 25 * 1024 * 1024
BANNER_WIDTHS = (800, 1600, 2400)

ITEM_ID = r"^GFT-[A-Z]{3}-\d{3}$"
SLUG = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
MEDIA_SRC = r"^/media/products/[a-z0-9-]+$"


class ProductImage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    src: str = Field(pattern=MEDIA_SRC)
    w: int = Field(gt=0, le=4000)
    h: int = Field(gt=0, le=4000)
    kind: Literal["hero", "detail", "lifestyle", "packaging"]
    alt: str = Field(min_length=3, max_length=160)
    formats: list[Literal["avif", "webp", "jpg"]] = ["avif", "webp", "jpg"]
    widths: list[Literal[600, 1200]] = [600, 1200]
    focal: dict[Literal["x", "y"], Annotated[float, Field(ge=0, le=100)]] = {"x": 50, "y": 50}
    fit: Literal["cover", "contain"] = "cover"
    color: str = Field(default="", max_length=20)


class Product(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    itemId: str = Field(pattern=ITEM_ID)
    id: int = Field(gt=0, lt=1_000_000)
    slug: str = Field(pattern=SLUG, max_length=80)
    name: str = Field(min_length=2, max_length=120)
    ne_name: str = Field(default="", max_length=160)
    cat: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=40)
    art: Literal["tumbler", "bottle", "giftbox", "teddy", "mug", "hamper"]
    price: int | None = Field(default=None, ge=1, le=1_000_000)
    compare: int = Field(default=0, ge=0, le=1_000_000)
    stock: int = Field(default=0, ge=0, le=100_000)
    colors: list[Annotated[str, Field(max_length=40)]] = Field(min_length=1, max_length=12)
    badge: Literal["", "best", "new", "gift", "personal"] = ""
    occasions: list[Annotated[str, Field(max_length=40)]] = Field(default_factory=list, max_length=12)
    blurb: str = Field(default="", max_length=400)
    ne_blurb: str = Field(default="", max_length=600)
    specs: list[Annotated[str, Field(max_length=120)]] = Field(default_factory=list, max_length=12)
    ne_specs: list[Annotated[str, Field(max_length=160)]] = Field(default_factory=list, max_length=12)
    images: list[ProductImage] = Field(default_factory=list, max_length=8)
    weight_kg: float = Field(default=0.5, gt=0, le=30)
    visible: bool = False

    @model_validator(mode="after")
    def _consistent(self) -> Product:
        if self.visible and self.price is None:
            raise ValueError("a product needs a price before it can be visible")
        if self.compare and self.price and self.compare <= self.price:
            self.compare = 0
        return self


class Catalog:
    def __init__(self, db: Database) -> None:
        self._db = db

    def all(self, *, visible_only: bool = False) -> list[dict[str, Any]]:
        sql = "SELECT data FROM products" + (" WHERE visible = 1" if visible_only else "") + " ORDER BY num_id"
        return [json.loads(r["data"]) for r in self._db.query(sql)]

    def get(self, item_id: str) -> dict[str, Any] | None:
        row = self._db.one("SELECT data FROM products WHERE item_id = ?", (item_id,))
        return json.loads(row["data"]) if row else None

    def by_num(self, num_id: int) -> dict[str, Any] | None:
        row = self._db.one("SELECT data FROM products WHERE num_id = ?", (num_id,))
        return json.loads(row["data"]) if row else None

    def upsert(self, product: Product) -> tuple[dict[str, Any], bool]:
        data = product.model_dump()
        with self._db.tx() as conn:
            clash = conn.execute(
                "SELECT item_id FROM products WHERE (num_id = ? OR slug = ?) AND item_id != ?",
                (product.id, product.slug, product.itemId),
            ).fetchone()
            if clash:
                raise HTTPException(status_code=409, detail=f"id or slug already used by {clash['item_id']}")
            created = conn.execute("SELECT 1 FROM products WHERE item_id = ?", (product.itemId,)).fetchone() is None
            conn.execute(
                "INSERT INTO products (item_id, num_id, slug, visible, data, updated_ts) VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(item_id) DO UPDATE SET num_id = excluded.num_id, slug = excluded.slug, "
                "visible = excluded.visible, data = excluded.data, updated_ts = excluded.updated_ts",
                (product.itemId, product.id, product.slug, int(product.visible), dumps(data), self._db.clock()),
            )
        return data, created

    def delete(self, item_id: str) -> bool:
        with self._db.tx() as conn:
            return conn.execute("DELETE FROM products WHERE item_id = ?", (item_id,)).rowcount == 1

    def adjust_stock(self, conn: Any, num_id: int, delta: int) -> None:
        row = conn.execute("SELECT data FROM products WHERE num_id = ?", (num_id,)).fetchone()
        if row is None:
            return
        data = json.loads(row["data"])
        data["stock"] = max(0, int(data.get("stock", 0)) + delta)
        conn.execute("UPDATE products SET data = ? WHERE num_id = ?", (dumps(data), num_id))


def _catalog(request: Request) -> Catalog:
    return request.app.state.catalog


Cat = Annotated[Catalog, Depends(_catalog)]


def build_catalog_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api/catalog")
    async def public_catalog(catalog: Cat) -> dict[str, Any]:
        return {"products": catalog.all(visible_only=True)}

    @router.get("/api/admin/products", dependencies=[Depends(require_admin)])
    async def admin_products(catalog: Cat) -> dict[str, Any]:
        return {"products": catalog.all()}

    @router.put("/api/admin/products/{item_id}", dependencies=[Depends(require_admin)])
    async def put_product(
        request: Request, item_id: Annotated[str, Path(pattern=ITEM_ID)], body: Product, catalog: Cat
    ) -> dict[str, Any]:
        if body.itemId != item_id:
            raise HTTPException(status_code=422, detail="itemId in the body must match the URL")
        request.app.state.ctx.taxonomy.check_product(body)
        data, created = catalog.upsert(body)
        return {"product": data, "created": created}

    @router.post("/api/admin/media", dependencies=[Depends(require_admin)])
    async def upload_media(
        request: Request,
        alt: Annotated[str, Query(max_length=160)] = "",
        kind: Annotated[Literal["photo", "qr", "banner"], Query()] = "photo",
    ) -> dict[str, Any]:
        length = int(request.headers.get("content-length") or 0)
        if length > MAX_UPLOAD:
            raise HTTPException(status_code=413, detail="Photos must be under 25 MB")
        body = await request.body()
        if not body:
            raise HTTPException(status_code=422, detail="No photo received")
        if len(body) > MAX_UPLOAD:
            raise HTTPException(status_code=413, detail="Photos must be under 25 MB")
        media_dir = FsPath(request.app.state.ctx.settings.site_dir).resolve() / "media" / "products"
        if kind == "qr":
            name = f"q-{secrets.token_hex(6)}.png"
            try:
                await run_in_threadpool(write_qr, body, media_dir / name)
            except ImageError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from None
            return {"src": f"/media/products/{name}"}
        if kind == "banner":
            stem = f"b-{secrets.token_hex(6)}"
            try:
                image = await run_in_threadpool(open_image, body)
                width, height = await run_in_threadpool(lambda: write_variants(image, media_dir, stem, crop=False, widths=BANNER_WIDTHS))
            except ImageError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from None
            return {"image": {"src": f"/media/products/{stem}", "w": width, "h": height, "widths": list(BANNER_WIDTHS)}}
        stem = f"u-{secrets.token_hex(6)}"
        try:
            image = await run_in_threadpool(open_image, body)
            width, height = await run_in_threadpool(write_variants, image, media_dir, stem, crop=False)
        except ImageError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None
        return {"image": {
            "src": f"/media/products/{stem}", "w": width, "h": height, "kind": "hero",
            "alt": clean(alt)[:160] or "Product photo", "formats": ["avif", "webp", "jpg"], "widths": list(WIDTHS),
            "focal": {"x": 50, "y": 45 if height > width * 1.25 else 50}, "fit": "cover", "color": "",
        }}

    @router.delete("/api/admin/products/{item_id}", dependencies=[Depends(require_admin)])
    async def delete_product(item_id: Annotated[str, Path(pattern=ITEM_ID)], catalog: Cat) -> dict[str, bool]:
        if not catalog.delete(item_id):
            raise HTTPException(status_code=404, detail="No such product")
        return {"deleted": True}

    return router
