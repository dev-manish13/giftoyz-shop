from __future__ import annotations

import hashlib
import hmac
import secrets
import sqlite3
import threading
import time
from collections.abc import Callable
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS shipments (
    ref TEXT PRIMARY KEY,
    ncm_id TEXT,
    phone_digest TEXT NOT NULL,
    created_ts REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS shipment_meta (
    key TEXT PRIMARY KEY,
    value BLOB NOT NULL
);
"""
_COLUMNS = {"uncertain": "INTEGER NOT NULL DEFAULT 0", "last_status": "TEXT NOT NULL DEFAULT ''"}


class ShipmentStore:
    def __init__(self, path: str, clock: Callable[[], float] = time.time) -> None:
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._clock = clock
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._db.executescript(_SCHEMA)
        existing = {row[1] for row in self._db.execute("PRAGMA table_info(shipments)")}
        for name, ddl in _COLUMNS.items():
            if name not in existing:
                self._db.execute(f"ALTER TABLE shipments ADD COLUMN {name} {ddl}")
        self._db.execute(
            "INSERT OR IGNORE INTO shipment_meta (key, value) VALUES ('pepper', ?)",
            (secrets.token_bytes(32),),
        )
        self._pepper = bytes(
            self._db.execute("SELECT value FROM shipment_meta WHERE key = 'pepper'").fetchone()[0]
        )

    def close(self) -> None:
        with self._lock:
            self._db.close()

    def digest(self, value: str) -> str:
        return hmac.new(self._pepper, value.encode(), hashlib.sha256).hexdigest()

    def reserve(self, ref: str, phone: str) -> tuple[bool, str | None, bool]:
        with self._lock:
            row = self._db.execute("SELECT ncm_id, uncertain FROM shipments WHERE ref = ?", (ref,)).fetchone()
            if row is not None:
                return False, row[0], bool(row[1])
            self._db.execute(
                "INSERT INTO shipments (ref, ncm_id, phone_digest, created_ts) VALUES (?, NULL, ?, ?)",
                (ref, self.digest(phone), self._clock()),
            )
            return True, None, False

    def complete(self, ref: str, ncm_id: str) -> None:
        with self._lock:
            self._db.execute("UPDATE shipments SET ncm_id = ?, uncertain = 0 WHERE ref = ?", (ncm_id, ref))

    def mark_uncertain(self, ref: str) -> None:
        with self._lock:
            self._db.execute("UPDATE shipments SET uncertain = 1 WHERE ref = ? AND ncm_id IS NULL", (ref,))

    def release(self, ref: str) -> None:
        with self._lock:
            self._db.execute("DELETE FROM shipments WHERE ref = ? AND ncm_id IS NULL", (ref,))

    def set_status(self, ref: str, status: str) -> None:
        with self._lock:
            self._db.execute("UPDATE shipments SET last_status = ? WHERE ref = ?", (status[:80], ref))

    def active(self) -> list[tuple[str, str, str]]:
        with self._lock:
            rows = self._db.execute(
                "SELECT ref, ncm_id, last_status FROM shipments WHERE ncm_id IS NOT NULL ORDER BY created_ts DESC LIMIT 500"
            ).fetchall()
        return [(r[0], r[1], r[2]) for r in rows]

    def ncm_id(self, ref: str) -> str | None:
        with self._lock:
            row = self._db.execute("SELECT ncm_id FROM shipments WHERE ref = ?", (ref,)).fetchone()
        return row[0] if row else None

    def ref_for(self, ncm_id: str) -> str | None:
        with self._lock:
            row = self._db.execute("SELECT ref FROM shipments WHERE ncm_id = ?", (ncm_id,)).fetchone()
        return row[0] if row else None

    def lookup_for_customer(self, query: str, phone: str) -> tuple[str, str] | None:
        with self._lock:
            row = self._db.execute(
                "SELECT ref, ncm_id, phone_digest FROM shipments WHERE ref = ? OR ncm_id = ?", (query, query)
            ).fetchone()
        expected = row[2] if row else self.digest("")
        matches = hmac.compare_digest(expected, self.digest(phone))
        return (row[0], row[1]) if row and row[1] and matches else None
