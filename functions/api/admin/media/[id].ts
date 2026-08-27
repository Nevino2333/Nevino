import type { PagesFunction } from "../_shared/types";
import { requireAuth, requireCsrf, requireOrigin } from "../_shared/auth";
import { first, run } from "../_shared/db";
import { json } from "../_shared/security";

type MediaAsset = { id: string; object_key: string; filename: string; mime_type: string; size: number; created_at: string };
const unavailable = (env: { DB?: D1Database; MEDIA_BUCKET?: R2Bucket }): Response | null => env.DB && env.MEDIA_BUCKET ? null : json({ error: "media_unavailable" }, 503);

export const onRequestDelete: PagesFunction = async (context) => {
	const denied = requireOrigin(context.request, context.env);
	if (denied) return denied;
	const auth = await requireAuth(context);
	if (auth.response) return auth.response;
	const csrf = await requireCsrf(context, auth.session);
	if (csrf) return csrf;
	const unavailableResponse = unavailable(context.env);
	if (unavailableResponse) return unavailableResponse;
	const id = context.params.id ?? "";
	try {
		const asset = await first<MediaAsset>(context.env.DB, "SELECT * FROM media_assets WHERE id = ?", id);
		if (!asset) return json({ error: "not_found" }, 404);
		const object = await context.env.MEDIA_BUCKET.get(asset.object_key);
		if (!object) return json({ error: "media_missing" }, 502);
		await context.env.MEDIA_BUCKET.delete(asset.object_key);
		try {
			await run(context.env.DB, "DELETE FROM media_assets WHERE id = ?", id);
		} catch {
			await context.env.MEDIA_BUCKET.put(asset.object_key, object.body, { httpMetadata: { contentType: asset.mime_type } });
			return json({ error: "media_delete_failed" }, 500);
		}
		return json({ ok: true });
	} catch {
		return json({ error: "media_delete_failed" }, 500);
	}
};
