from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, Response

from . import seo
from .catalog import Catalog, build_catalog_router
from .client import NcmClient
from .config import Settings, get_settings
from .context import Context
from .db import Database
from .khalti import KhaltiClient
from .orders import build_orders_router, poll_ncm
from .ratelimit import RateLimiter
from .rates import RateStore, daily_rates, load_rates
from .routes import Services, build_router
from .shop_settings import SettingsStore, build_settings_router, public_view
from .taxonomy import TaxonomyStore, build_taxonomy_router
from .security import add_nonce, nonce, page_policy
from .store import ShipmentStore

PUBLIC_FILE = re.compile(r"^[a-z0-9][a-z0-9-]*\.(html|js|css|png|jpg|jpeg|webp|avif|svg|ico)$")
MEDIA_FILE = re.compile(r"^([a-z0-9-]+-(600|800|1200|1600|2400)\.(avif|webp|jpg)|q-[a-f0-9]{12}\.png)$")
NO_CACHE = {".html", ".js", ".css"}
BUSINESS_PHONE = "9709119177"


def create_app(
    settings: Settings | None = None,
    *,
    ncm_client: NcmClient | None = None,
    khalti_client: KhaltiClient | None = None,
) -> FastAPI:
    config = settings or get_settings()
    site = Path(config.site_dir).resolve()
    media = (site / "media" / "products").resolve()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        http = httpx.AsyncClient()
        db = Database(config.database_path)
        shipments = ShipmentStore(config.database_path)
        client = ncm_client
        if client is None and config.ncm_api_token is not None:
            client = NcmClient(
                http=http,
                token=config.ncm_api_token.get_secret_value(),
                base_url=config.ncm_base_url.rstrip("/"),
                timeout=config.ncm_timeout_seconds,
                max_retries=config.ncm_max_retries,
                events=db.log_ncm,
            )
        khalti = khalti_client
        if khalti is None and config.khalti_secret_key is not None:
            khalti = KhaltiClient(
                http=http,
                secret_key=config.khalti_secret_key.get_secret_value(),
                base_url=config.khalti_base_url,
                timeout=config.khalti_timeout_seconds,
            )
        app.state.ncm = Services(
            client=client,
            store=shipments,
            admin_key=config.admin_api_key.get_secret_value() if config.admin_api_key else None,
            pickup_branch=config.ncm_pickup_branch.strip().upper(),
            track_limiter=RateLimiter(config.track_limit_per_minute, 60),
            auth_limiter=RateLimiter(5, 60),
            webhook_secret=config.ncm_webhook_secret.get_secret_value() if config.ncm_webhook_secret else None,
            public_base_url=config.public_base_url,
        )
        catalog = Catalog(db)
        app.state.catalog = catalog
        app.state.ctx = Context(
            settings=config,
            db=db,
            catalog=catalog,
            rates=RateStore(db, load_rates(site / "data.js")),
            khalti=khalti,
            order_limiter=RateLimiter(config.order_limit_per_minute, 60),
            pay_limiter=RateLimiter(10, 60),
            shop=SettingsStore(db, config.cod_advance),
            taxonomy=TaxonomyStore(db),
        )
        poller = (
            asyncio.create_task(poll_ncm(app.state.ctx, app.state.ncm, interval=config.ncm_poll_minutes * 60))
            if config.ncm_poll_minutes > 0 and client is not None
            else None
        )
        pickup = config.ncm_pickup_branch.strip().upper()
        refresher = (
            asyncio.create_task(daily_rates(app.state.ctx.rates, client, pickup, hours=config.ncm_rates_hours))
            if config.ncm_rates_hours > 0 and client is not None and pickup
            else None
        )
        app.state.ncm.branch_for = app.state.ctx.rates.ncm_name
        try:
            yield
        finally:
            for task in (poller, refresher):
                if task is not None:
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)
            await http.aclose()
            shipments.close()
            db.close()

    app = FastAPI(title="GifToyz", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    app.state.trust_proxy = config.trust_proxy
    https = config.public_base_url.startswith("https://")

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        size = request.headers.get("content-length", "")
        if size.isdigit() and int(size) > 26 * 1024 * 1024:
            return PlainTextResponse("Request too large", status_code=413)
        response = await call_next(request)
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if config.public_base_url.startswith("https://"):
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if request.url.path.startswith(("/ncm", "/api")):
            response.headers["Cache-Control"] = "no-store"
            response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        return response

    app.include_router(build_router())
    app.include_router(build_catalog_router())
    app.include_router(build_orders_router())
    app.include_router(build_settings_router())
    app.include_router(build_taxonomy_router())

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/robots.txt")
    async def robots() -> PlainTextResponse:
        return PlainTextResponse(seo.robots(config.public_base_url))

    @app.get("/sitemap.xml")
    async def sitemap(request: Request) -> Response:
        db: Database = request.app.state.ctx.db
        row = db.one("SELECT MAX(updated_ts) AS ts FROM products WHERE visible = 1")
        ts = row["ts"] if row and row["ts"] else db.clock()
        body = seo.sitemap(config.public_base_url, request.app.state.catalog.all(visible_only=True), ts)
        return Response(body, media_type="application/xml")

    @app.get("/media/products/{name}")
    async def media_file(name: str) -> FileResponse:
        if not MEDIA_FILE.match(name):
            raise HTTPException(status_code=404)
        path = (media / name).resolve()
        if path.parent != media or not path.is_file():
            raise HTTPException(status_code=404)
        return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})

    @app.get("/{name}")
    async def public_file(name: str, request: Request) -> Response:
        if not PUBLIC_FILE.match(name):
            raise HTTPException(status_code=404)
        path = (site / name).resolve()
        if path.parent != site or not path.is_file():
            raise HTTPException(status_code=404)
        if path.suffix == ".html":
            return render_page(request, name, path)
        if path.suffix in NO_CACHE:
            cache = "public, max-age=31536000, immutable" if "v" in request.query_params else "no-cache"
        else:
            cache = "public, max-age=86400"
        return FileResponse(path, headers={"Cache-Control": cache})

    def render_page(request: Request, name: str, path: Path) -> HTMLResponse:
        state = request.app.state
        catalog = state.catalog.all(visible_only=True)
        query = {k: v for k, v in request.query_params.items() if k in ("item", "cat")}
        shop = public_view(state.ctx.shop.get())
        config_js = {
            "api": True,
            "khalti": state.ctx.khalti is not None,
            "codAdvance": shop["codAdvance"],
        }
        body, status = seo.render(
            path.read_text(encoding="utf-8"), name, query,
            base=config.public_base_url, catalog=catalog, config=config_js, settings=shop, taxonomy=state.ctx.taxonomy.get().model_dump(), rates=state.ctx.rates.public(), phone=shop["phone"],
        )
        value = nonce()
        headers = {"Cache-Control": "no-cache", "Content-Security-Policy": page_policy(value, https)}
        if name in ("admin.html", "checkout.html"):
            headers["X-Robots-Tag"] = "noindex, nofollow"
        return HTMLResponse(add_nonce(body, value), status_code=status, headers=headers)

    @app.get("/")
    async def index(request: Request) -> Response:
        return render_page(request, "index.html", site / "index.html")

    return app
