CREATE TABLE IF NOT EXISTS mmp_reliability_state (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mmp_reliability_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checked_at TEXT NOT NULL,
  severity TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mmp_reliability_events_checked_at
  ON mmp_reliability_events(checked_at DESC);
