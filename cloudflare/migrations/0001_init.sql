-- Same tables and columns as server/ (SQLite) so data copies across unchanged.

CREATE TABLE products (
    item_id TEXT PRIMARY KEY,
    num_id INTEGER NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    visible INTEGER NOT NULL,
    data TEXT NOT NULL,
    updated_ts REAL NOT NULL
);

CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    phone_digest TEXT NOT NULL,
    token_digest TEXT NOT NULL,
    status TEXT NOT NULL,
    data TEXT NOT NULL,
    created_ts REAL NOT NULL,
    updated_ts REAL NOT NULL
);
CREATE INDEX orders_created ON orders (created_ts);
CREATE INDEX orders_status ON orders (status);

CREATE TABLE payments (
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
CREATE INDEX payments_order ON payments (order_id);

CREATE TABLE ncm_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    ref TEXT NOT NULL,
    op TEXT NOT NULL,
    code TEXT NOT NULL,
    http_status INTEGER NOT NULL,
    message TEXT NOT NULL
);
CREATE INDEX ncm_events_ts ON ncm_events (ts);

CREATE TABLE webhook_events (
    key TEXT PRIMARY KEY,
    ts REAL NOT NULL
);

CREATE TABLE shipments (
    ref TEXT PRIMARY KEY,
    ncm_id TEXT,
    phone_digest TEXT NOT NULL,
    created_ts REAL NOT NULL,
    uncertain INTEGER NOT NULL DEFAULT 0,
    last_status TEXT NOT NULL DEFAULT ''
);

CREATE TABLE shipment_meta (
    key TEXT PRIMARY KEY,
    value BLOB NOT NULL
);

CREATE TABLE rates (
    key TEXT PRIMARY KEY,
    home INTEGER NOT NULL,
    branch INTEGER NOT NULL,
    source TEXT NOT NULL,
    updated_ts REAL NOT NULL,
    ncm_name TEXT
);

CREATE TABLE rate_sync (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
CREATE TABLE taxonomy (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
CREATE TABLE shop_settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);

-- Fixed-window rate limits (replaces the in-memory RateLimiter).
CREATE TABLE rate_limits (
    key TEXT PRIMARY KEY,
    window_start REAL NOT NULL,
    count INTEGER NOT NULL
);

-- Product reviews (owner request, REBUILD.md item 2). Shown only when approved.
CREATE TABLE reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    name TEXT NOT NULL,
    stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'hidden')),
    created_ts REAL NOT NULL,
    UNIQUE (item_id, order_id)
);
CREATE INDEX reviews_item ON reviews (item_id, status);
