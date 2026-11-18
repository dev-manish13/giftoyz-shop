-- Workers free plan allows 50 outside calls per run, so NCM work is done in batches with saved progress.
ALTER TABLE shipments ADD COLUMN checked_ts REAL NOT NULL DEFAULT 0;
CREATE INDEX shipments_ncm ON shipments (ncm_id);
CREATE TABLE jobs (name TEXT PRIMARY KEY, data TEXT NOT NULL);
