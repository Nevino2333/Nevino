ALTER TABLE admin_drafts ADD COLUMN publication_state TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE admin_drafts ADD COLUMN workspace_state TEXT NOT NULL DEFAULT 'modified';
ALTER TABLE admin_drafts ADD COLUMN deployed_commit_sha TEXT;
ALTER TABLE admin_drafts ADD COLUMN deployed_at TEXT;
ALTER TABLE admin_drafts ADD COLUMN deleted_at TEXT;

UPDATE admin_drafts
SET publication_state = CASE
	WHEN status = 'published' THEN 'published'
	ELSE 'draft'
END,
workspace_state = CASE
	WHEN status = 'published' AND sync_status = 'published' THEN 'clean'
	ELSE 'modified'
END,
deployed_commit_sha = CASE
	WHEN status = 'published' AND sync_status = 'published' THEN commit_sha
	ELSE NULL
END,
deployed_at = CASE
	WHEN status = 'published' AND sync_status = 'published' AND commit_sha IS NOT NULL THEN updated_at
	ELSE NULL
END;

CREATE INDEX IF NOT EXISTS idx_admin_drafts_visible_updated
ON admin_drafts(deleted_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_drafts_content_state
ON admin_drafts(publication_state, workspace_state, sync_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS admin_content_revisions (
	id TEXT PRIMARY KEY,
	draft_id TEXT NOT NULL,
	content_id TEXT NOT NULL,
	version INTEGER NOT NULL,
	source TEXT NOT NULL CHECK(source IN ('save', 'import', 'publish', 'rollback')),
	title TEXT NOT NULL,
	slug TEXT NOT NULL,
	markdown TEXT NOT NULL,
	content_sha256 TEXT NOT NULL,
	github_blob_sha TEXT,
	github_commit_sha TEXT,
	created_by TEXT NOT NULL,
	created_at TEXT NOT NULL,
	FOREIGN KEY(draft_id) REFERENCES admin_drafts(id),
	FOREIGN KEY(created_by) REFERENCES admin_users(id),
	UNIQUE(draft_id, version)
);

CREATE INDEX IF NOT EXISTS idx_admin_content_revisions_draft_version
ON admin_content_revisions(draft_id, version DESC);

CREATE TABLE IF NOT EXISTS admin_content_operations (
	id TEXT PRIMARY KEY,
	idempotency_key TEXT NOT NULL UNIQUE,
	type TEXT NOT NULL CHECK(type IN ('import', 'rename', 'withdraw', 'rollback')),
	status TEXT NOT NULL CHECK(status IN ('pending', 'github_committed', 'completed', 'reconciliation_required', 'failed')),
	draft_id TEXT,
	content_id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	expected_version INTEGER NOT NULL,
	source_path TEXT,
	target_path TEXT,
	expected_blob_sha TEXT,
	result_blob_sha TEXT,
	commit_sha TEXT,
	content_sha256 TEXT NOT NULL,
	source_commit_sha TEXT,
	error_code TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	completed_at TEXT,
	FOREIGN KEY(draft_id) REFERENCES admin_drafts(id),
	FOREIGN KEY(user_id) REFERENCES admin_users(id)
);

CREATE INDEX IF NOT EXISTS idx_admin_content_operations_draft_created
ON admin_content_operations(draft_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_content_operations_active_draft
ON admin_content_operations(draft_id)
WHERE status IN ('pending', 'github_committed', 'reconciliation_required');
