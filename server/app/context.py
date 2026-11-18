from __future__ import annotations

from dataclasses import dataclass

from fastapi import Request

from .catalog import Catalog
from .config import Settings
from .db import Database
from .khalti import KhaltiClient
from .ratelimit import RateLimiter
from .rates import RateStore
from .shop_settings import SettingsStore
from .taxonomy import TaxonomyStore


@dataclass
class Context:
    settings: Settings
    db: Database
    catalog: Catalog
    rates: RateStore
    khalti: KhaltiClient | None
    order_limiter: RateLimiter
    pay_limiter: RateLimiter
    shop: SettingsStore
    taxonomy: TaxonomyStore


def get_context(request: Request) -> Context:
    return request.app.state.ctx
