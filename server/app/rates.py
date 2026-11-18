from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .db import Database, dumps

logger = logging.getLogger(__name__)

_BLOCK = re.compile(r"const ncmRows = `([^`]*)`", re.S)
_ROW = re.compile(r"^([A-Z0-9][A-Z0-9 .()/&-]*)\|(\d+)\|(\d+)$")
NCM_NAMES = {
    "BAGLUNG": "BAGLUNG BAZAR",
    "CHAINPUR SANKHUWASABHA": "CHAINPUR SANKHUWASAB",
    "CHAKARGHATTI": "CHAKARGHATTI SUNSARI",
    "CHITWAN": "NARAYANGHAT",
    "DARBANG": "DARBANG MYAGDI",
    "DIPAYAL SILGADHI": "DIPAYAL",
    "GAUSHALA": "GAUSHALA MAHOTTARI",
    "GORKHA": "GORKHA BAZAR",
    "HANUMANNAGAR": "HANUMANNAGR",
    "ILAM": "ILAM BAZAR",
    "JUGEDA": "JUGEDI",
    "MAHARAJGUNJ KAPILBASTU": "MAHARAJGUNJ KAPILBAS",
    "MANGALBARE": "MANGALBARE ILAM",
    "NARAYANPUR": "NARAYANPUR DANG",
    "NEPALTAR BAZAR": "NEPALTAR ILAM",
    "NEPALTAR KATHMANDU": "KAVRESTHALI",
    "PALPA": "TANSEN",
    "RAMPUR": "RAMPUR PALPA",
    "SAKUWA MAHENDRANAGAR": "DHANUSA MAHENDRANAGR",
    "TAPLEJUNG": "PHUNGLING",
}
HOME_TYPE = "Pickup/Collect"
BRANCH_TYPE = "D2B"


@dataclass(frozen=True)
class Rate:
    key: str
    home: int
    branch: int


def load_rates(data_js: Path) -> dict[str, Rate]:
    match = _BLOCK.search(data_js.read_text(encoding="utf-8"))
    if not match:
        raise RuntimeError(f"No NCM rate card found in {data_js}")
    rates: dict[str, Rate] = {}
    for line in match.group(1).splitlines():
        row = _ROW.match(line.strip())
        if row:
            rates[row.group(1)] = Rate(row.group(1), int(row.group(2)), int(row.group(3)))
    if not rates:
        raise RuntimeError("The NCM rate card is empty")
    return rates


class RateStore:
    def __init__(self, db: Database, card: dict[str, Rate]) -> None:
        self._db = db
        self.running = False
        with db.tx() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS rates (key TEXT PRIMARY KEY, home INTEGER NOT NULL, branch INTEGER NOT NULL, "
                "source TEXT NOT NULL, updated_ts REAL NOT NULL)"
            )
            conn.execute("CREATE TABLE IF NOT EXISTS rate_sync (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)")
            if "ncm_name" not in {row[1] for row in conn.execute("PRAGMA table_info(rates)")}:
                conn.execute("ALTER TABLE rates ADD COLUMN ncm_name TEXT")
            for r in card.values():
                conn.execute(
                    "INSERT OR IGNORE INTO rates (key, home, branch, source, updated_ts) VALUES (?, ?, ?, 'card', ?)",
                    (r.key, r.home, r.branch, db.clock()),
                )
            for key, name in NCM_NAMES.items():
                conn.execute("UPDATE rates SET ncm_name = ? WHERE key = ? AND ncm_name IS NULL", (name, key))
        self._cache: dict[str, Rate] | None = None
        self._names: dict[str, str] | None = None

    def all(self) -> dict[str, Rate]:
        if self._cache is None:
            rows = self._db.query("SELECT key, home, branch FROM rates")
            self._cache = {r["key"]: Rate(r["key"], r["home"], r["branch"]) for r in rows}
        return self._cache

    def get(self, key: str) -> Rate | None:
        return self.all().get(key)

    def ncm_name(self, key: str) -> str:
        if self._names is None:
            self._names = {r["key"]: r["ncm_name"] for r in self._db.query("SELECT key, ncm_name FROM rates WHERE ncm_name IS NOT NULL")}
        return self._names.get(key, key)

    def public(self) -> dict[str, list[int]]:
        return {k: [r.home, r.branch] for k, r in self.all().items()}

    def rows(self) -> list[dict[str, Any]]:
        return [dict(r) for r in self._db.query("SELECT key, home, branch, source, updated_ts, ncm_name FROM rates ORDER BY key")]

    def last_sync(self) -> dict[str, Any] | None:
        row = self._db.one("SELECT data FROM rate_sync WHERE id = 1")
        return json.loads(row["data"]) if row else None

    def save(self, results: dict[str, tuple[int, int]], failed: list[str], origin: str) -> dict[str, Any]:
        now = self._db.clock()
        changed = []
        with self._db.tx() as conn:
            for key, (home, branch) in results.items():
                old = conn.execute("SELECT home, branch FROM rates WHERE key = ?", (key,)).fetchone()
                if old and (old["home"], old["branch"]) != (home, branch):
                    changed.append({"key": key, "old": [old["home"], old["branch"]], "new": [home, branch]})
                conn.execute(
                    "INSERT INTO rates (key, home, branch, source, updated_ts) VALUES (?, ?, ?, 'ncm', ?) "
                    "ON CONFLICT(key) DO UPDATE SET home = excluded.home, branch = excluded.branch, source = 'ncm', updated_ts = excluded.updated_ts",
                    (key, home, branch, now),
                )
            summary = {"at": now, "origin": origin, "checked": len(results) + len(failed), "updated": len(results), "failed": failed[:50], "failed_count": len(failed), "changed": changed}
            conn.execute(
                "INSERT INTO rate_sync (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
                (dumps(summary),),
            )
        self._cache = None
        return summary


async def sync_rates(store: RateStore, client: Any, origin: str, *, concurrency: int = 4, only: list[str] | None = None) -> dict[str, Any]:
    if store.running:
        raise RuntimeError("A price refresh is already running")
    store.running = True
    try:
        keys = sorted(only) if only else sorted(store.all())
        gate = asyncio.Semaphore(concurrency)
        results: dict[str, tuple[int, int]] = {}
        failed: list[str] = []

        async def one(key: str) -> None:
            async with gate:
                try:
                    name = store.ncm_name(key)
                    home = await client.shipping_rate(origin, name, HOME_TYPE)
                    branch = await client.shipping_rate(origin, name, BRANCH_TYPE)
                except Exception:
                    failed.append(key)
                    return
                if home > 0 and branch > 0:
                    results[key] = (home, branch)
                else:
                    failed.append(key)

        await asyncio.gather(*(one(k) for k in keys))
        summary = store.save(results, sorted(failed), origin)
        logger.info("NCM prices refreshed: %d updated, %d changed, %d failed", summary["updated"], len(summary["changed"]), summary["failed_count"])
        return summary
    finally:
        store.running = False


async def daily_rates(store: RateStore, client: Any, origin: str, *, hours: float) -> None:
    while True:
        last = store.last_sync()
        due = 0.0 if not last else max(0.0, last["at"] + hours * 3600 - store._db.clock())
        await asyncio.sleep(max(60.0, due))
        try:
            await sync_rates(store, client, origin)
        except Exception:
            logger.exception("Daily NCM price refresh failed")
