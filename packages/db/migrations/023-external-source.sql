-- Opt-in external observations; existing gates keep their paid API polling mode.
CREATE TABLE gate_external_sources(
 gate_id TEXT PRIMARY KEY REFERENCES engagement_gates(id) ON DELETE CASCADE,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 epoch TEXT NOT NULL,
 enabled_at INTEGER NOT NULL,
 scan_id TEXT, scan_expires_at INTEGER, scan_from INTEGER, scan_until INTEGER,
 next_page INTEGER NOT NULL DEFAULT 0, next_token TEXT,
 last_complete_at INTEGER, coverage_until INTEGER
);
CREATE TABLE gate_external_receipts(
 scan_id TEXT NOT NULL, page INTEGER NOT NULL, gate_id TEXT NOT NULL REFERENCES engagement_gates(id) ON DELETE CASCADE,
 digest TEXT NOT NULL, received_at INTEGER NOT NULL,
 PRIMARY KEY(scan_id,page)
);
