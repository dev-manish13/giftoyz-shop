-- Small key-value store for shop wiring that isn't a shop setting (Telegram chat for order alerts).
CREATE TABLE app_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
