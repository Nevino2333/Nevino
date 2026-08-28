-- 站点访客统计：无需第三方服务，基于 D1 的轻量计数
-- visit_days: 每日浏览量(pv)与独立访客(uv)
CREATE TABLE IF NOT EXISTS visit_days (
	day TEXT PRIMARY KEY,
	pv INTEGER NOT NULL DEFAULT 0,
	uv INTEGER NOT NULL DEFAULT 0
);

-- visit_uv: 每日独立访客明细（访客为客户端随机 UUID，无个人身份信息）
CREATE TABLE IF NOT EXISTS visit_uv (
	day TEXT NOT NULL,
	visitor TEXT NOT NULL,
	PRIMARY KEY (day, visitor)
);

-- visit_visitors: 全站累计独立访客
CREATE TABLE IF NOT EXISTS visit_visitors (
	visitor TEXT PRIMARY KEY,
	first_seen TEXT NOT NULL
);

-- 定期清理 90 天前的每日明细，控制表体积（累计总数仍在 visit_days/visit_visitors）
CREATE INDEX IF NOT EXISTS idx_visit_uv_day ON visit_uv(day);
