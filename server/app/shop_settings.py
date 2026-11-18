from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .db import Database, dumps
from .routes import clean, require_admin

QR_SRC = r"^/media/products/q-[a-f0-9]{12}\.png$"


class QrCodes(BaseModel):
    model_config = ConfigDict(extra="forbid")

    esewa: Annotated[str, Field(pattern=QR_SRC)] | None = None
    khalti: Annotated[str, Field(pattern=QR_SRC)] | None = None
    bank: Annotated[str, Field(pattern=QR_SRC)] | None = None


class PayAccount(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(default="", max_length=60)
    number: str = Field(default="", max_length=40, pattern=r"^[0-9 +-]*$")
    bank: str = Field(default="", max_length=60)

    @field_validator("name", "bank")
    @classmethod
    def _printable(cls, value: str) -> str:
        return clean(value)


class PayAccounts(BaseModel):
    model_config = ConfigDict(extra="forbid")

    esewa: PayAccount = Field(default_factory=PayAccount)
    khalti: PayAccount = Field(default_factory=PayAccount)
    bank: PayAccount = Field(default_factory=PayAccount)


class BannerImage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    src: str = Field(pattern=r"^/media/products/b-[a-f0-9]{12}$")
    w: int = Field(gt=0, le=10000)
    h: int = Field(gt=0, le=10000)
    widths: list[Literal[800, 1600, 2400]] = [800, 1600, 2400]


class Banner(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: str = Field(pattern=r"^[a-f0-9]{8,16}$")
    image: BannerImage
    mobile: BannerImage | None = None
    alt: str = Field(default="", max_length=160)
    title_en: str = Field(default="", max_length=80)
    title_ne: str = Field(default="", max_length=120)
    text_en: str = Field(default="", max_length=160)
    text_ne: str = Field(default="", max_length=220)
    cta_en: str = Field(default="", max_length=30)
    cta_ne: str = Field(default="", max_length=40)
    link: str = Field(default="", max_length=300, pattern=r"^((/|[a-z0-9-]+\.html)[^\s<>\"']*|https://[^\s<>\"']+)?$")
    starts: str = Field(default="", pattern=r"^(\d{4}-\d{2}-\d{2})?$")
    ends: str = Field(default="", pattern=r"^(\d{4}-\d{2}-\d{2})?$")
    active: bool = True

    @field_validator("alt", "title_en", "title_ne", "text_en", "text_ne", "cta_en", "cta_ne")
    @classmethod
    def _printable(cls, value: str) -> str:
        return clean(value)

    def showing_on(self, day: str) -> bool:
        return self.active and (not self.starts or self.starts <= day) and (not self.ends or day <= self.ends)


class ShopSettings(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    phone: str = Field(default="9709119177", pattern=r"^\d{7,15}$")
    whatsapp: str = Field(default="9779709119177", pattern=r"^977\d{10}$")
    instagram: str = Field(default="giftoyz.np", pattern=r"^[A-Za-z0-9._]{1,30}$")
    tiktok: str = Field(default="giftoyz.np", pattern=r"^([A-Za-z0-9._]{2,24})?$")
    facebook: str = Field(default="", pattern=r"^([A-Za-z0-9.]{5,50})?$")
    email: str = Field(default="", pattern=r"^([^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,})?$")
    hours_en: str = Field(default="Every day, 9 am to 8 pm", max_length=80)
    hours_ne: str = Field(default="हरेक दिन, बिहान ९ देखि बेलुका ८ बजेसम्म", max_length=120)
    orders_paused: bool = False
    pause_en: str = Field(default="We're taking a short break. Orders open again soon.", max_length=160)
    pause_ne: str = Field(default="हामी केही दिनको बिदामा छौं। छिट्टै फेरि अर्डर खुल्छ।", max_length=200)
    announce_en: str = Field(default="Delivery to 300+ places across Nepal.", max_length=160)
    announce_ne: str = Field(default="नेपालभर ३००+ ठाउँमा डेलिभरी।", max_length=200)
    codAdvance: bool = True
    lowStock: int = Field(default=5, ge=0, le=1000)
    qr: QrCodes = Field(default_factory=QrCodes)
    qr_info: PayAccounts = Field(default_factory=PayAccounts)
    banners: list[Banner] = Field(default_factory=list, max_length=8)
    banners_enabled: bool = True
    banner_seconds: int = Field(default=6, ge=3, le=20)

    @field_validator("announce_en", "announce_ne", "hours_en", "hours_ne", "pause_en", "pause_ne")
    @classmethod
    def _printable(cls, value: str) -> str:
        return clean(value)


class SettingsStore:
    def __init__(self, db: Database, cod_default: bool) -> None:
        self._db = db
        self._cod_default = cod_default
        with db.tx() as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS shop_settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)")

    def get(self) -> ShopSettings:
        row = self._db.one("SELECT data FROM shop_settings WHERE id = 1")
        if row is None:
            return ShopSettings(codAdvance=self._cod_default)
        return ShopSettings(**json.loads(row["data"]))

    def put(self, value: ShopSettings) -> ShopSettings:
        with self._db.tx() as conn:
            conn.execute(
                "INSERT INTO shop_settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
                (dumps(value.model_dump()),),
            )
        return value


NPT = timezone(timedelta(hours=5, minutes=45))


def public_view(settings: ShopSettings, now: datetime | None = None) -> dict[str, Any]:
    day = (now or datetime.now(NPT)).astimezone(NPT).strftime("%Y-%m-%d")
    data = settings.model_dump()
    data["banners"] = [b.model_dump() for b in settings.banners if b.showing_on(day)] if settings.banners_enabled else []
    return data


def _store(request: Request) -> SettingsStore:
    return request.app.state.ctx.shop


Store = Annotated[SettingsStore, Depends(_store)]


def build_settings_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api/settings")
    async def public_settings(store: Store) -> dict[str, Any]:
        return {"settings": public_view(store.get())}

    @router.get("/api/admin/settings", dependencies=[Depends(require_admin)])
    async def admin_settings(store: Store) -> dict[str, Any]:
        return {"settings": store.get().model_dump()}

    @router.put("/api/admin/settings", dependencies=[Depends(require_admin)])
    async def save_settings(body: ShopSettings, store: Store) -> dict[str, Any]:
        return {"settings": store.put(body).model_dump()}

    return router
