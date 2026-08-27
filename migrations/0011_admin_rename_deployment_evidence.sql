ALTER TABLE admin_drafts ADD COLUMN deployed_path TEXT;
ALTER TABLE admin_drafts ADD COLUMN deployed_blob_sha TEXT;

UPDATE admin_drafts
SET deployed_path = github_path,
	deployed_blob_sha = github_sha
WHERE publication_state = 'published'
	AND deployed_commit_sha IS NOT NULL;

PRAGMA foreign_keys = OFF;

CREATE TABLE admin_content_revisions_rename (
	id TEXT PRIMARY KEY,
	draft_id TEXT NOT NULL,
	content_id TEXT NOT NULL,
	version INTEGER NOT NULL,
	source TEXT NOT NULL CHECK(source IN ('save', 'import', 'publish', 'rename', 'rollback')),
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

INSERT INTO admin_content_revisions_rename
SELECT * FROM admin_content_revisions;

DROP TABLE admin_content_revisions;
ALTER TABLE admin_content_revisions_rename RENAME TO admin_content_revisions;

CREATE INDEX idx_admin_content_revisions_draft_version
ON admin_content_revisions(draft_id, version DESC);

PRAGMA foreign_keys = ON;
