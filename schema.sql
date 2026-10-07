CREATE TABLE IF NOT EXISTS hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  path TEXT,
  ua TEXT,
  label TEXT,
  ip TEXT,
  country TEXT,
  asn TEXT,
  as_org TEXT,
  referer TEXT
);
CREATE INDEX IF NOT EXISTS hits_ts ON hits(ts);
CREATE INDEX IF NOT EXISTS hits_label ON hits(label);
