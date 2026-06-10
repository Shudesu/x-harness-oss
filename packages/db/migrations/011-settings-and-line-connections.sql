-- 011: settings (key-value store) と line_connections テーブルを追加。
-- 既存環境向け。新規環境では schema.sql に含まれているため適用不要。

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS line_connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  worker_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- 202606新規追加開始
INSERT OR IGNORE INTO settings (
  key,
  value,
  updated_at
)
VALUES (
  'auto_features_enabled',
  'true',
  datetime('now')
);
-- 202606新規追加終了