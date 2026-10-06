import type { PagesFunction } from "../api/admin/_shared/types";

interface VisitEnv {
	DB?: D1Database;
	ALLOWED_ORIGIN?: string;
}

const UUID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
// 与前端 localSlug 的解析保持一致：/posts/{slug}/
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/;

const statsResponse = (
	data: Record<string, number>,
): Response =>
	Response.json(
		{ data },
		{ headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
	);

const originAllowed = (request: Request, env: VisitEnv): boolean => {
	// 站点自身的页面默认放行（同源 beacon），ALLOWED_ORIGIN 用于绑定自定义域名等场景
	let expected = "";
	try {
		expected = new URL(request.url).origin;
	} catch {
		return false;
	}
	const origin = request.headers.get("Origin");
	if (origin) return origin === expected || origin === env.ALLOWED_ORIGIN;
	const referer = request.headers.get("Referer");
	if (!referer) return false;
	try {
		const refererOrigin = new URL(referer).origin;
		return refererOrigin === expected || refererOrigin === env.ALLOWED_ORIGIN;
	} catch {
		return false;
	}
};

const localDay = (): string => {
	// 站点面向中文访客，按东八区切分“今日”
	return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
};

const readStats = async (
	db: D1Database,
	slug = "",
): Promise<Record<string, number>> => {
	const day = localDay();
	const today = await db.prepare("SELECT pv, uv FROM visit_days WHERE day = ?")
		.bind(day)
		.first<{ pv: number; uv: number }>();
	const totals = await db
		.prepare("SELECT COALESCE(SUM(pv), 0) AS pageviews FROM visit_days")
		.first<{ pageviews: number }>();
	const visitors = await db
		.prepare("SELECT COUNT(*) AS visitors FROM visit_visitors")
		.first<{ visitors: number }>();
	const data: Record<string, number> = {
		available: 1,
		todayVisitors: today?.uv ?? 0,
		todayPageviews: today?.pv ?? 0,
		visitors: visitors?.visitors ?? 0,
		pageviews: totals?.pageviews ?? 0,
	};
	if (slug) {
		const post = await db
			.prepare("SELECT views FROM post_views WHERE slug = ?")
			.bind(slug)
			.first<{ views: number }>();
		data.slug = 1;
		data.views = post?.views ?? 0;
	}
	return data;
};

export const onRequestPost: PagesFunction<VisitEnv> = async (context) => {
	if (!context.env.DB) return statsResponse({ available: 0 });
	if (!originAllowed(context.request, context.env)) {
		return new Response(null, { status: 403 });
	}
	let visitor = "";
	let slug = "";
	try {
		const body = (await context.request.json()) as {
			visitor?: unknown;
			slug?: unknown;
		};
		visitor = typeof body.visitor === "string" ? body.visitor : "";
		slug = typeof body.slug === "string" ? body.slug : "";
	} catch {
		visitor = "";
	}
	if (!UUID_PATTERN.test(visitor)) return statsResponse({ available: 0 });
	if (slug && !SLUG_PATTERN.test(slug)) slug = "";

	const day = localDay();
	const db = context.env.DB;
	try {
		// 浏览量：按天累加
		await db
			.prepare(
				"INSERT INTO visit_days (day, pv, uv) VALUES (?, 1, 0) ON CONFLICT(day) DO UPDATE SET pv = pv + 1",
			)
			.bind(day)
			.run();
		// 当日独立访客：仅当新出现时累加 uv（changes 可从 run 结果直接拿到）
		const uvInsert = await db
			.prepare("INSERT OR IGNORE INTO visit_uv (day, visitor) VALUES (?, ?)")
			.bind(day, visitor)
			.run();
		if (uvInsert.meta.changes === 1) {
			await db
				.prepare("UPDATE visit_days SET uv = uv + 1 WHERE day = ?")
				.bind(day)
				.run();
		}
		// 全站累计独立访客
		await db
			.prepare(
				"INSERT OR IGNORE INTO visit_visitors (visitor, first_seen) VALUES (?, ?)",
			)
			.bind(visitor, new Date().toISOString())
			.run();
		// 文章页浏览量：仅当 beacon 携带合法 slug
		if (slug) {
			await db
				.prepare(
					"INSERT INTO post_views (slug, views) VALUES (?, 1) ON CONFLICT(slug) DO UPDATE SET views = views + 1",
				)
				.bind(slug)
				.run();
		}
		return statsResponse(await readStats(db, slug));
	} catch {
		return statsResponse({ available: 0 });
	}
};

export const onRequestGet: PagesFunction<VisitEnv> = async (context) => {
	if (!context.env.DB) return statsResponse({ available: 0 });
	// ?slug= 查询单篇文章浏览量（PostViews 组件取数用）
	let slug = "";
	try {
		slug = new URL(context.request.url).searchParams.get("slug") ?? "";
	} catch {
		slug = "";
	}
	if (slug && !SLUG_PATTERN.test(slug)) slug = "";
	try {
		return statsResponse(await readStats(context.env.DB, slug));
	} catch {
		return statsResponse({ available: 0 });
	}
};