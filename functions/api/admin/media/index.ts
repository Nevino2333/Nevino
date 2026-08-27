import { query, run } from "../_shared/db";
import { ApiError } from "../_shared/errors";
import { adminGet, adminMutation } from "../_shared/handler";
import { randomToken } from "../_shared/security";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED: Record<
	string,
	{ mime: string; extension: string; extensions: string[] }
> = {
	"image/png": { mime: "image/png", extension: "png", extensions: ["png"] },
	"image/jpeg": {
		mime: "image/jpeg",
		extension: "jpg",
		extensions: ["jpg", "jpeg"],
	},
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
const extensionOf = (name: string): string =>
	name.toLowerCase().split(".").pop() ?? "";
const publicUrl = (objectKey: string): string =>
	`/media/${objectKey.replace(/^\/+/, "").replace(/^media\//, "")}`;
const withPublicUrl = (asset: Omit<MediaAsset, "public_url">): MediaAsset => ({
	...asset,
	public_url: publicUrl(asset.object_key),
});
const matchesMagic = (bytes: Uint8Array, mime: string): boolean => {
	if (mime === "image/png")
		return (
			bytes.length >= 8 &&
			bytes
				.slice(0, 8)
				.every(
					(value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index],
				)
		);
	if (mime === "image/jpeg")
		return (
			bytes.length >= 3 &&
			bytes[0] === 255 &&
			bytes[1] === 216 &&
			bytes[2] === 255
		);
	if (mime === "image/webp")
		return (
			bytes.length >= 12 &&
			new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
			new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
		);
	return (
		bytes.length >= 6 &&
		(new TextDecoder().decode(bytes.slice(0, 6)) === "GIF87a" ||
			new TextDecoder().decode(bytes.slice(0, 6)) === "GIF89a")
	);
};
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
		(!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BYTES)
	)
		throw new ApiError(413, "payload_too_large", "文件过大");
	const form = await context.request.formData();
	const value = form.get("file");
	if (!(value instanceof File) || value.size === 0 || value.size > MAX_BYTES)
		throw new ApiError(400, "invalid_file", "图片文件无效");
	const mime = value.type.toLowerCase();
	const format = ALLOWED[mime];
	if (!format?.extensions.includes(extensionOf(value.name)))
		throw new ApiError(415, "invalid_media_type", "图片类型不受支持");
	const bytes = new Uint8Array(await value.arrayBuffer());
	if (!matchesMagic(bytes, mime))
		throw new ApiError(415, "invalid_media_signature", "图片内容与类型不匹配");
	const id = randomToken(16);
	const objectKey = `media/${id}.${format.extension}`;
	const createdAt = new Date().toISOString();
	await bucket.put(objectKey, bytes, { httpMetadata: { contentType: mime } });
	try {
		await run(
			context.env.DB,
			"INSERT INTO media_assets (id, object_key, filename, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			id,
			objectKey,
			value.name.slice(0, 255),
			mime,
			value.size,
			createdAt,
		);
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
				mime_type: mime,
				size: value.size,
				created_at: createdAt,
			}),
		},
		status: 201,
	};
});
