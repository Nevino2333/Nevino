import { query, run } from "../_shared/db";
import { ApiError } from "../_shared/errors";
import { adminGet, adminMutation } from "../_shared/handler";
import { validateUpload } from "../_shared/media-validation";
import { randomToken } from "../_shared/security";

type MediaAsset = {
	id: string;
	object_key: string;
	filename: string;
	mime_type: string;
	size: number;
	created_at: string;
	public_url: string;
};

const publicUrl = (objectKey: string): string =>
	`/media/${objectKey.replace(/^\/+/, "").replace(/^media\//, "")}`;

const withPublicUrl = (asset: Omit<MediaAsset, "public_url">): MediaAsset => ({
	...asset,
	public_url: publicUrl(asset.object_key),
});

const requireMedia = (env: {
	DB?: D1Database;
	MEDIA_BUCKET?: R2Bucket;
}): R2Bucket => {
	if (!env.DB || !env.MEDIA_BUCKET)
		throw new ApiError(503, "media_unavailable", "媒体库暂不可用", true);
	return env.MEDIA_BUCKET;
};

export const onRequestGet = adminGet(async (context) => {
	requireMedia(context.env);
	const result = await query<Omit<MediaAsset, "public_url">>(
		context.env.DB,
		"SELECT id, object_key, filename, mime_type, size, created_at FROM media_assets ORDER BY created_at DESC",
	);
	return { media: result.results.map(withPublicUrl) };
});

export const onRequestPost = adminMutation(async (context) => {
	const bucket = requireMedia(context.env);
	const contentLength = context.request.headers.get("Content-Length");
	if (
		contentLength &&
		(!/^\d+$/.test(contentLength) || Number(contentLength) > 20 * 1024 * 1024)
	)
		throw new ApiError(413, "payload_too_large", "文件过大");
	const form = await context.request.formData();
	const value = form.get("file");
	if (!(value instanceof File) || value.size === 0)
		throw new ApiError(400, "invalid_file", "文件无效或为空");
	const bytes = new Uint8Array(await value.arrayBuffer());
	const resolved = validateUpload(value.name, value.type, value.size, bytes);
	const id = randomToken(16);
	const objectKey = "media/" + id + "." + resolved.extension;
	const createdAt = new Date().toISOString();
	await bucket.put(objectKey, bytes, {
		httpMetadata: { contentType: resolved.mime },
	});
	try {
		const inserted = await run(
			context.env.DB,
			"INSERT INTO media_assets (id, object_key, filename, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			id,
			objectKey,
			value.name.slice(0, 255),
			resolved.mime,
			value.size,
			createdAt,
		);
		if (!inserted.success)
			throw new Error("media_insert_failed");
	} catch {
		await bucket.delete(objectKey);
		throw new ApiError(500, "media_create_failed", "媒体记录创建失败", true);
	}
	return {
		data: {
			media: withPublicUrl({
				id,
				object_key: objectKey,
				filename: value.name.slice(0, 255),
				mime_type: resolved.mime,
				size: value.size,
				created_at: createdAt,
			}),
		},
		status: 201,
	};
});
