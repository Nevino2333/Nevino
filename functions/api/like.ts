import type { PagesFunction } from "./admin/_shared/types";

interface LikeEnv {
	DB?: D1Database;
	ALLOWED_ORIGIN?: string;
}

const UUID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

const likeResponse = (data: Record<string, unknown>): Response =>
	Response.json(
		{ data },
		{ headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
	);

const originAllowed = (request: Request, env: LikeEnv): boolean => {
	// 同源 beacon 默认放行；ALLOWED_ORIGIN 兼容自定义域名
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

const readLikes = async (
	db: D1Database,
	slug: string,
): Promise<{ count: number }> => {
	const row = await db
		.prepare("SELECT count FROM post_likes WHERE slug = ?")
		.bind(slug)
		.first<{ count: number }>();
	return { count: row?.count ?? 0 };
};

export const onRequestGet: PagesFunction<LikeEnv> = async (context) => {
	if (!context.env.DB) return likeResponse({ available: 0 });
	const slug = new URL(context.request.url).searchParams.get("slug") || "";
	if (!SLUG_PATTERN.test(slug)) return likeResponse({ available: 0 });
	try {
		const { count } = await readLikes(context.env.DB, slug);
		return likeResponse({ available: 1, likes: count });
	} catch {
		return likeResponse({ available: 0 });
	}
};

export const onRequestPost: PagesFunction<LikeEnv> = async (context) => {
	if (!context.env.DB) return likeResponse({ available: 0 });
	if (!originAllowed(context.request, context.env)) {
		return new Response(null, { status: 403 });
	}
	let slug = "";
	let visitor = "";
	try {
		const body = (await context.request.json()) as {
			slug?: unknown;
			visitor?: unknown;
		};
		slug = typeof body.slug === "string" ? body.slug : "";
		visitor = typeof body.visitor === "string" ? body.visitor : "";
	} catch {
		slug = "";
		visitor = "";
	}
	if (!SLUG_PATTERN.test(slug) || !UUID_PATTERN.test(visitor)) {
		return likeResponse({ available: 0 });
	}

	const db = context.env.DB;
	try {
		const existing = await db
			.prepare("SELECT 1 AS liked FROM post_like_voters WHERE slug = ? AND visitor = ?")
			.bind(slug, visitor)
			.first();
		let liked: boolean;
		if (existing) {
			await db
				.prepare("DELETE FROM post_like_voters WHERE slug = ? AND visitor = ?")
				.bind(slug, visitor)
				.run();
			await db
				.prepare("UPDATE post_likes SET count = MAX(count - 1, 0) WHERE slug = ?")
				.bind(slug)
				.run();
			liked = false;
		} else {
			await db
				.prepare(
					"INSERT INTO post_like_voters (slug, visitor, created_at) VALUES (?, ?, ?)",
				)
				.bind(slug, visitor, new Date().toISOString())
				.run();
			await db
				.prepare(
					"INSERT INTO post_likes (slug, count) VALUES (?, 1) ON CONFLICT(slug) DO UPDATE SET count = count + 1",
				)
				.bind(slug)
				.run();
			liked = true;
		}
		const { count } = await readLikes(db, slug);
		return likeResponse({ available: 1, likes: count, liked });
	} catch {
		return likeResponse({ available: 0 });
	}
};
