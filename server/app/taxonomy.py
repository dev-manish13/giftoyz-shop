from __future__ import annotations

import json
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .db import Database, dumps
from .routes import clean, require_admin

SLUG = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"


class Named(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: str = Field(pattern=SLUG, max_length=40)
    en: str = Field(min_length=1, max_length=40)
    ne: str = Field(default="", max_length=60)

    @model_validator(mode="after")
    def _clean(self) -> Named:
        self.en, self.ne = clean(self.en), clean(self.ne)
        return self


class Category(Named):
    code: str = Field(pattern=r"^[A-Z]{3}$")
    art: Literal["tumbler", "bottle", "giftbox", "teddy", "mug", "hamper"] = "giftbox"
    color: str = Field(default="#F86808", pattern=r"^#[0-9A-Fa-f]{6}$")


class Colour(Named):
    hex: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")


class Occasion(Named):
    pass


class Taxonomy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    categories: list[Category] = Field(min_length=1, max_length=40)
    colors: list[Colour] = Field(min_length=1, max_length=60)
    occasions: list[Occasion] = Field(default_factory=list, max_length=40)

    @model_validator(mode="after")
    def _unique(self) -> Taxonomy:
        for name, items in (("category", self.categories), ("colour", self.colors), ("occasion", self.occasions)):
            ids = [i.id for i in items]
            if len(ids) != len(set(ids)):
                raise ValueError(f"Two {name} entries have the same id")
        codes = [c.code for c in self.categories]
        if len(codes) != len(set(codes)):
            raise ValueError("Two categories use the same item code")
        return self


DEFAULT = Taxonomy(
    categories=[
        Category(id="tumblers", en="Tumblers", ne="टम्बलर", code="TUM", art="tumbler", color="#1E1E1E"),
        Category(id="bottles", en="Bottles", ne="बोतल", code="BOT", art="bottle", color="#F86808"),
        Category(id="gift-boxes", en="Gift boxes", ne="गिफ्ट बक्स", code="BOX", art="giftbox", color="#F86808"),
        Category(id="teddies", en="Teddies", ne="टेडी", code="TED", art="teddy", color="#C47A3D"),
        Category(id="mugs", en="Mugs", ne="मग", code="MUG", art="mug", color="#FFFFFF"),
        Category(id="plush", en="Plush toys", ne="सफ्ट ट्वाय", code="PLU", art="teddy", color="#A9CDEB"),
    ],
    colors=[
        Colour(id="black", en="Midnight black", ne="कालो", hex="#1E1E1E"),
        Colour(id="orange", en="Sunset orange", ne="सुन्तला", hex="#F86808"),
        Colour(id="cream", en="Cream", ne="क्रिम", hex="#F1E4CF"),
        Colour(id="mint", en="Mint", ne="मिन्ट हरियो", hex="#A8DCC6"),
        Colour(id="pink", en="Blush pink", ne="गुलाबी", hex="#F5B8C6"),
        Colour(id="lilac", en="Lilac", ne="हल्का बैजनी", hex="#CDBBF0"),
        Colour(id="white", en="White", ne="सेतो", hex="#FFFFFF"),
        Colour(id="brown", en="Honey brown", ne="खैरो", hex="#C47A3D"),
        Colour(id="sky", en="Sky blue", ne="आकाशे नीलो", hex="#A9CDEB"),
        Colour(id="red", en="Red", ne="रातो", hex="#C8202F"),
        Colour(id="yellow", en="Yellow", ne="पहेँलो", hex="#F5D33B"),
        Colour(id="blue", en="Blue", ne="नीलो", hex="#3F6FB5"),
    ],
    occasions=[
        Occasion(id="birthday", en="Birthday", ne="जन्मदिन"),
        Occasion(id="anniversary", en="Anniversary", ne="वार्षिकोत्सव"),
        Occasion(id="for-her", en="For her", ne="उनका लागि"),
        Occasion(id="for-him", en="For him", ne="उहाँका लागि"),
        Occasion(id="for-kids", en="For kids", ne="बच्चाका लागि"),
        Occasion(id="just-because", en="Just because", ne="यत्तिकै"),
    ],
)


class TaxonomyStore:
    def __init__(self, db: Database) -> None:
        self._db = db
        with db.tx() as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS taxonomy (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)")
        self._cache: Taxonomy | None = None

    def get(self) -> Taxonomy:
        if self._cache is None:
            row = self._db.one("SELECT data FROM taxonomy WHERE id = 1")
            self._cache = Taxonomy(**json.loads(row["data"])) if row else DEFAULT
        return self._cache

    def put(self, value: Taxonomy) -> Taxonomy:
        usage = self._usage()
        old = self.get()
        old_codes = {c.id: c.code for c in old.categories}
        problems = []
        for kind, items in (("category", value.categories), ("colour", value.colors), ("occasion", value.occasions)):
            kept = {i.id for i in items}
            for item_id, count in usage[kind].items():
                if item_id not in kept:
                    problems.append(f"{count} product(s) still use the {kind} '{item_id}'")
        for c in value.categories:
            if c.id in old_codes and old_codes[c.id] != c.code and usage["category"].get(c.id):
                problems.append(f"Item code of '{c.en}' can't change while products use it")
        if problems:
            raise HTTPException(status_code=409, detail="; ".join(problems[:5]) + ". Move or delete those products first.")
        with self._db.tx() as conn:
            conn.execute(
                "INSERT INTO taxonomy (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
                (dumps(value.model_dump()),),
            )
        self._cache = value
        return value

    def _usage(self) -> dict[str, dict[str, int]]:
        usage: dict[str, dict[str, int]] = {"category": {}, "colour": {}, "occasion": {}}
        for row in self._db.query("SELECT data FROM products"):
            p = json.loads(row["data"])
            usage["category"][p["cat"]] = usage["category"].get(p["cat"], 0) + 1
            for c in p.get("colors", []):
                usage["colour"][c] = usage["colour"].get(c, 0) + 1
            for o in p.get("occasions", []):
                usage["occasion"][o] = usage["occasion"].get(o, 0) + 1
        return usage

    def check_product(self, product: Any) -> None:
        tax = self.get()
        cat = next((c for c in tax.categories if c.id == product.cat), None)
        if cat is None:
            raise HTTPException(status_code=422, detail=f"unknown category {product.cat}")
        if product.itemId[4:7] != cat.code:
            raise HTTPException(status_code=422, detail=f"itemId for {product.cat} must start with GFT-{cat.code}-")
        if unknown := set(product.colors) - {c.id for c in tax.colors}:
            raise HTTPException(status_code=422, detail=f"unknown colours {sorted(unknown)}")
        if unknown := set(product.occasions) - {o.id for o in tax.occasions}:
            raise HTTPException(status_code=422, detail=f"unknown occasions {sorted(unknown)}")


def _store(request: Request) -> TaxonomyStore:
    return request.app.state.ctx.taxonomy


Store = Annotated[TaxonomyStore, Depends(_store)]


def build_taxonomy_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api/taxonomy")
    async def public_taxonomy(store: Store) -> dict[str, Any]:
        return {"taxonomy": store.get().model_dump()}

    @router.put("/api/admin/taxonomy", dependencies=[Depends(require_admin)])
    async def save_taxonomy(body: Taxonomy, store: Store) -> dict[str, Any]:
        return {"taxonomy": store.put(body).model_dump()}

    return router
