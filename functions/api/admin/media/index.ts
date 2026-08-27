import type { PagesFunction } from "../_shared/types";
import { requireAuth, requireCsrf, requireOrigin, requireAdminGetOrigin } from "../_shared/auth";
import { query, run } from "../_shared/db";
import { json, randomToken } from "../_shared/security";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED: Record<string, { mime: string; extension: string; extensions: string[] }> = {
	"image/png": { mime: "image/png", extension: "png", extensions: ["png"] },
	"image/jpeg": { mime: "image/jpeg", extension: "jpg", extensions: ["jpg", "jpeg"] },
	"image/webp": { mime: "image/webp", extension: "webp", extensions: ["webp"] },
	"image/gif": { mime: "image/gif", extension: "gif", extensions: ["gif"] },
};

type MediaAsset = {
	id: string;
	object_key: string;
	filename: string;
	mime_type: string;
	size: number;
	created_at: string;
	public_url: string;
};

const extensionOf = (name: string): string => name.toLowerCase().split(".").pop() ?? "";
const publicUrl = (objectKey: string): string => `/media/${objectKey.replace(/^\/+/, "").replace(/^media\//, "")}`;
const withPublicUrl = (asset: Omit<MediaAsset, "public_url">): MediaAsset => ({ ...asset, public_url: publicUrl(asset.object_key) });
const matchesMagic = (bytes: Uint8Array, mime: string): boolean => {
	if (mime === "image/png") return bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index]);
	if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
	if (mime === "image/webp") return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
	return bytes.length >= 6 && (new TextDecoder().decode(bytes.slice(0, 6)) === "GIF87a" || new TextDecoder().decode(bytes.slice(0, 6)) === "GIF89a");
};
const unavailable = (env: { DB?: D1Database; MEDIA_BUCKET?: R2Bucket }): Response | null => env.DB && env.MEDIA_BUCKET ? null : json({ error: "media_unavailable" }, 503);

export const onRequestGet: PagesFunction = async (context) => {
	const denied = requireAdminGetOrigin(context.request, context.env);
	if (denied) return denied;
	const auth = await requireAuth(context);
	if (auth.response) return auth.response;
	const unavailableResponse = unavailable(context.env);
	if (unavailableResponse) return unavailableResponse;
	try {
		const result = await query<Omit<MediaAsset, "public_url">>(context.env.DB, "SELECT id, object_key, filename, mime_type, size, created_at FROM media_assets ORDER BY created_at DESC");
		return json({ media: result.results.map(withPublicUrl) });
	} catch {
		return json({ error: "media_list_failed" }, 500);
	}
};

export const onRequestPost: PagesFunction = async (context) => {
	const denied = requireOrigin(context.request, context.env);
	if (denied) return denied;
	const auth = await requireAuth(context);
	if (auth.response) return auth.response;
	const csrf = await requireCsrf(context, auth.session);
	if (csrf) return csrf;
	const unavailableResponse = unavailable(context.env);
	if (unavailableResponse) return unavailableResponse;
	const contentLength = context.request.headers.get("Content-Length");
	if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BYTES)) return json({ error: "payload_too_large" }, 413);
	try {
		const form = await context.request.formData();
		const value = form.get("file");
		if (!(value instanceof File) || value.size === 0 || value.size > MAX_BYTES) return json({ error: "invalid_file" }, 400);
		const mime = value.type.toLowerCase();
		const format = ALLOWED[mime];
		if (!format || !format.extensions.includes(extensionOf(value.name))) return json({ error: "invalid_media_type" }, 415);
		const bytes = new Uint8Array(await value.arrayBuffer());
		if (!matchesMagic(bytes, mime)) return json({ error: "invalid_media_signature" }, 415);
		const id = randomToken(16);
		const objectKey = `media/${id}.${format.extension}`;
		const createdAt = new Date().toISOString();
		await context.env.MEDIA_BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: mime } });
		try {
			await run(context.env.DB, "INSERT INTO media_assets (id, object_key, filename, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, objectKey, value.name.slice(0, 255), mime, value.size, createdAt);
		} catch {
			await context.env.MEDIA_BUCKET.delete(objectKey);
			return json({ error: "media_create_failed" }, 500);
		}
		return json({ media: withPublicUrl({ id, object_key: objectKey, filename: value.name.slice(0, 255), mime_type: mime, size: value.size, created_at: createdAt }) }, 201);
	} catch {
		return json({ error: "media_upload_failed" }, 500);
	}
};
