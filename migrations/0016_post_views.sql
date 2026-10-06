-- 每篇文章浏览量：beacon 上报携带 slug 时累加（只存总数，不记访客维度）
CREATE TABLE IF NOT EXISTS post_views (
	slug TEXT PRIMARY KEY,
	views INTEGER NOT NULL DEFAULT 0
);
