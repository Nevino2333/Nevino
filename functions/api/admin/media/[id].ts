import { audit, bestEffortAudit } from "../_shared/audit";
import { first, run } from "../_shared/db";
import { ApiError } from "../_shared/errors";
import { adminMutation } from "../_shared/handler";

type MediaAsset = {
	id: string;
	object_key: string;
	filename: string;
	mime_type: string;
	size: number;
	created_at: string;
};

export const onRequestDelete = adminMutation(async (context) => {
	const bucket = context.env.MEDIA_BUCKET;
	if (!bucket)
		throw new ApiError(503, "media_unavailable", "媒体库暂不可用", true);
	const id = context.params.id ?? "";
	const asset = await first<MediaAsset>(
		context.env.DB,
		"SELECT id, object_key, filename, mime_type, size, created_at FROM media_assets WHERE id = ?",
		id,
	);
	if (!asset) throw new ApiError(404, "not_found", "媒体不存在");
	const object = await bucket.get(asset.object_key);
	if (!object) {
		// R2 对象已缺失：数据库记录留着只会成为永远删不掉的"幽灵"条目，直接清理掉
		await run(context.env.DB, "DELETE FROM media_assets WHERE id = ?", id);
		await bestEffortAudit(() =>
			audit(
				context.env,
				context.session.user_id,
				"media_delete",
				context.request,
				{
					requestId: context.requestId,
					resourceType: "media",
					resourceId: id,
					result: "success",
					metadata: { objectMissing: true, filename: asset.filename },
				},
			),
		);
		return { deleted: true, objectMissing: true };
	}
	await bucket.delete(asset.object_key);
	try {
		await run(context.env.DB, "DELETE FROM media_assets WHERE id = ?", id);
	} catch {
		await bucket.put(asset.object_key, object.body, {
			httpMetadata: { contentType: asset.mime_type },
		});
		throw new ApiError(500, "media_delete_failed", "媒体删除失败", true);
	}
	await bestEffortAudit(() =>
		audit(
			context.env,
			context.session.user_id,
			"media_delete",
			context.request,
			{
				requestId: context.requestId,
				resourceType: "media",
				resourceId: id,
				result: "success",
				metadata: { filename: asset.filename, size: asset.size },
			},
		),
	);
	return { deleted: true };
});
