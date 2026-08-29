PRAGMA foreign_keys = OFF;

-- 独立页面（spec 内容集合）的在线编辑绑定
CREATE TABLE admin_pages (
	page_key TEXT PRIMARY KEY,
	github_path TEXT NOT NULL UNIQUE,
	github_blob_sha TEXT,
	commit_sha TEXT,
	version INTEGER NOT NULL DEFAULT 1,
	content TEXT NOT NULL DEFAULT '',
	staged_content TEXT,
	staged_blob_sha TEXT,
	staged_at TEXT,
	deployed_blob_sha TEXT,
	deployed_commit_sha TEXT,
	deployed_at TEXT,
	deleted_at TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE admin_page_revisions (
	id TEXT PRIMARY KEY,
	page_key TEXT NOT NULL,
	version INTEGER NOT NULL,
	source TEXT NOT NULL CHECK(source IN ('save', 'publish', 'import', 'restore')),
	content TEXT NOT NULL,
	content_sha256 TEXT NOT NULL,
	blob_sha TEXT,
	commit_sha TEXT,
	created_at TEXT NOT NULL
);

CREATE INDEX idx_admin_page_revisions_page
ON admin_page_revisions(page_key, version DESC);

-- 站点配置分组的远端状态与暂存变更集
CREATE TABLE admin_config_state (
	config_key TEXT PRIMARY KEY,
	file_path TEXT NOT NULL,
	version INTEGER NOT NULL DEFAULT 1,
	github_blob_sha TEXT,
	commit_sha TEXT,
	staged_payload TEXT,
	staged_blob_sha TEXT,
	staged_by TEXT,
	staged_at TEXT,
	deployed_blob_sha TEXT,
	deployed_commit_sha TEXT,
	deployed_at TEXT,
	updated_at TEXT NOT NULL
);

-- 已发布的配置版本，支持差异回看与恢复
CREATE TABLE admin_config_history (
	id TEXT PRIMARY KEY,
	config_key TEXT NOT NULL,
	version INTEGER NOT NULL,
	payload TEXT NOT NULL,
	file_path TEXT NOT NULL,
	blob_sha TEXT,
	commit_sha TEXT,
	applied_by TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE INDEX idx_admin_config_history_key
ON admin_config_history(config_key, version DESC);

PRAGMA foreign_keys = ON;
