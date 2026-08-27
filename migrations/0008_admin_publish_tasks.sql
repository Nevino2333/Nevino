ALTER TABLE admin_drafts ADD COLUMN content_id TEXT;
ALTER TABLE admin_drafts ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE admin_drafts ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'local';

UPDATE admin_drafts SET content_id = id WHERE content_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_drafts_content_id
ON admin_drafts(content_id);

CREATE TABLE IF NOT EXISTS admin_publish_tasks (
	id TEXT PRIMARY KEY,
	idempotency_key TEXT NOT NULL UNIQUE,
	draft_id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	expected_version INTEGER NOT NULL,
	target_path TEXT NOT NULL,
	content_sha256 TEXT NOT NULL,
	status TEXT NOT NULL CHECK(status IN ('pending', 'publishing', 'github_committed', 'awaiting_deploy', 'published', 'validation_failed', 'content_conflict', 'submit_failed', 'reconciliation_required', 'build_failed', 'rolled_back')),
	attempts INTEGER NOT NULL DEFAULT 0,
	github_blob_sha TEXT,
	github_commit_sha TEXT,
	error_code TEXT,
	error_detail TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	completed_at TEXT,
	FOREIGN KEY(draft_id) REFERENCES admin_drafts(id),
	FOREIGN KEY(user_id) REFERENCES admin_users(id)
);

CREATE INDEX IF NOT EXISTS idx_admin_publish_tasks_status_updated
ON admin_publish_tasks(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_admin_publish_tasks_draft_created
ON admin_publish_tasks(draft_id, created_at DESC);
