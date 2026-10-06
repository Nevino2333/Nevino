-- 文章点赞：匿名轻量互动，按访客 UUID 去重、可再次点击取消
-- post_likes: 每篇文章的点赞总数
CREATE TABLE IF NOT EXISTS post_likes (
	slug TEXT PRIMARY KEY,
	count INTEGER NOT NULL DEFAULT 0
);

-- post_like_voters: 访客点赞明细（vistor 为客户端匿名 UUID，无个人身份信息）
CREATE TABLE IF NOT EXISTS post_like_voters (
	slug TEXT NOT NULL,
	visitor TEXT NOT NULL,
	created_at TEXT NOT NULL,
	PRIMARY KEY (slug, visitor)
);
