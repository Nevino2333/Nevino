CREATE TABLE IF NOT EXISTS admin_users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at);
CREATE TABLE IF NOT EXISTS admin_drafts (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, published TEXT NOT NULL, updated TEXT, description TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', category TEXT NOT NULL DEFAULT '', lang TEXT NOT NULL DEFAULT '', pinned INTEGER NOT NULL DEFAULT 0, comment INTEGER NOT NULL DEFAULT 1, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_audit (id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '', metadata TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_admin_drafts_updated ON admin_drafts(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at DESC);
