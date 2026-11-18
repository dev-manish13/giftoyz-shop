from __future__ import annotations

import json
import sqlite3
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

_SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS products (
    item_id TEXT PRIMARY KEY,
    num_id INTEGER NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    visible INTEGER NOT NULL,
    data TEXT NOT NULL,
    updated_ts REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    phone_digest TEXT NOT NULL,
    token_digest TEXT NOT NULL,
    status TEXT NOT NULL,
    data TEXT NOT NULL,
    created_ts REAL NOT NULL,
    updated_ts REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_created ON orders (created_ts);
CREATE TABLE IF NOT EXISTS payments (
    pidx TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id),
    amount_paisa INTEGER NOT NULL,
    status TEXT NOT NULL,
    payment_url TEXT NOT NULL,
    expires_at TEXT NOT NULL DEFAULT '',
    transaction_id TEXT NOT NULL DEFAULT '',
    created_ts REAL NOT NULL,
    updated_ts REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_order ON payments (order_id);
CREATE TABLE IF NOT EXISTS ncm_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    ref TEXT NOT NULL,
    op TEXT NOT NULL,
    code TEXT NOT NULL,
    http_status INTEGER NOT NULL,
    message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ncm_events_ts ON ncm_events (ts);
CREATE TABLE IF NOT EXISTS webhook_events (
    key TEXT PRIMARY KEY,
    ts REAL NOT NULL
);
"""


class Database:
    def __init__(self, path: str, clock: Callable[[], float] = time.time) -> None:
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.clock = clock
        self._lock = threading.RLock()
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.executescript(_SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._db.close()

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                yield self._db
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
            self._db.execute("COMMIT")

    def query(self, sql: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._db.execute(sql, params).fetchall()

    def one(self, sql: str, params: tuple[Any, ...] = ()) -> sqlite3.Row | None:
        with self._lock:
            return self._db.execute(sql, params).fetchone()

    def log_ncm(self, *, ref: str, op: str, code: str, http_status: int, message: str) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO ncm_events (ts, ref, op, code, http_status, message) VALUES (?, ?, ?, ?, ?, ?)",
                (self.clock(), ref[:40], op[:40], code[:40], http_status, message[:300]),
            )

    def ncm_events(self, limit: int = 100) -> list[dict[str, Any]]:
        rows = self.query("SELECT * FROM ncm_events ORDER BY id DESC LIMIT ?", (limit,))
        return [dict(r) for r in rows]

    def first_webhook(self, key: str) -> bool:
        with self._lock:
            cur = self._db.execute(
                "INSERT OR IGNORE INTO webhook_events (key, ts) VALUES (?, ?)", (key, self.clock())
            )
            return cur.rowcount == 1


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
