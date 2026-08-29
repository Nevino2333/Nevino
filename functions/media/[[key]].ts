import type { PagesFunction } from "../api/admin/_shared/types";

const CONTENT_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	mp3: "audio/mpeg",
	flac: "audio/flac",
	ogg: "audio/ogg",
	wav: "audio/wav",
	m4a: "audio/mp4",
	lrc: "text/plain; charset=utf-8",
	txt: "text/plain; charset=utf-8",
};

const KEY_PATTERN =
	/^[A-Za-z0-9_-]{22}\.(png|jpg|webp|gif|mp3|flac|ogg|wav|m4a|lrc|txt)$/;

const errorResponse = (error: string, status: number): Response =>
	Response.json(
		{ error },
		{
			status,
			headers: {
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff",
			},
		},
	);

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
