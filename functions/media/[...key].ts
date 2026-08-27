import type { PagesFunction } from "../api/admin/_shared/types";

const CONTENT_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
};

const KEY_PATTERN = /^[A-Za-z0-9_-]{22}\.(png|jpg|webp|gif)$/;

const errorResponse = (error: string, status: number): Response =>
	Response.json({ error }, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export const onRequestGet: PagesFunction = async (context) => {
	if (!context.env.MEDIA_BUCKET) return errorResponse("media_unavailable", 503);
	const key = context.params.key ?? "";
	const match = KEY_PATTERN.exec(key);
	if (!match) return errorResponse("not_found", 404);
	try {
		const object = await context.env.MEDIA_BUCKET.get(`media/${key}`);
		if (!object) return errorResponse("not_found", 404);
		return new Response(object.body, {
			headers: {
				"Cache-Control": "public, max-age=31536000, immutable",
				"Content-Type": CONTENT_TYPES[match[1]],
				ETag: object.httpEtag,
				"X-Content-Type-Options": "nosniff",
			},
		});
	} catch {
		return errorResponse("media_read_failed", 500);
	}
};
