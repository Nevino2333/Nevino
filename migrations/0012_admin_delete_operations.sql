PRAGMA foreign_keys = OFF;

CREATE TABLE admin_content_operations_delete (
	id TEXT PRIMARY KEY,
	idempotency_key TEXT NOT NULL UNIQUE,
	type TEXT NOT NULL CHECK(type IN ('import', 'rename', 'withdraw', 'delete', 'rollback')),
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

INSERT INTO admin_content_operations_delete
SELECT * FROM admin_content_operations;

DROP TABLE admin_content_operations;
ALTER TABLE admin_content_operations_delete RENAME TO admin_content_operations;

CREATE INDEX idx_admin_content_operations_draft_created
ON admin_content_operations(draft_id, created_at DESC);

CREATE UNIQUE INDEX idx_admin_content_operations_active_draft
ON admin_content_operations(draft_id)
WHERE status IN ('pending', 'github_committed', 'reconciliation_required');

PRAGMA foreign_keys = ON;