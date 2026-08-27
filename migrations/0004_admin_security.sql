CREATE TABLE IF NOT EXISTS admin_login_attempts (key TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, window_started_at INTEGER NOT NULL, locked_until INTEGER, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_updated ON admin_login_attempts(updated_at);
CREATE TABLE IF NOT EXISTS admin_bootstrap_lock (id INTEGER PRIMARY KEY CHECK (id = 1), claimed_at TEXT NOT NULL);
