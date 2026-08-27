import type { PagesFunction } from "../_shared/types";
import { requireAdminGetOrigin, requireAuth, requireCsrf, requireOrigin } from "../_shared/auth";
import { getDraft, run } from "../_shared/db";
import { json } from "../_shared/security";
import { readJson } from "../_shared/body";
import { validateDraft } from "../_shared/validation";

const DRAFT_BODY_LIMIT = 1024 * 1024;
import { audit } from "../_shared/audit";

const idOf = (context: { params: Record<string, string | undefined> }): string => context.params.id ?? "";
export const onRequestGet: PagesFunction = async (context) => {
	const denied = requireAdminGetOrigin(context.request, context.env);
	if (denied) return denied;
	const auth = await requireAuth(context);
	if (auth.response) return auth.response;
	const draft = await getDraft(context.env, idOf(context));
	return draft ? json({ draft }) : json({ error: "not_found" }, 404);
};

export const onRequestPut: PagesFunction = async (context) => {
	const denied = requireOrigin(context.request, context.env);
	if (denied) return denied;
	const auth = await requireAuth(context);
	if (auth.response) return auth.response;
	const current = await getDraft(context.env, idOf(context));
	if (!current) return json({ error: "not_found" }, 404);
	if (current.status === "published") return json({ error: "draft_immutable" }, 409);
	const csrf = await requireCsrf(context, auth.session);
	if (csrf) return csrf;
	const parsed = await readJson(context.request, DRAFT_BODY_LIMIT);
	if (parsed.response) return json({ error: "invalid_request" }, parsed.response.status);
	const input = parsed.data;
	const checked = validateDraft(input);
	if (!checked.data) return json({ error: "validation_failed", fields: checked.errors }, 422);
	try {
		const draft = checked.data;
		const now = new Date().toISOString();
		const result = await run(context.env.DB, "UPDATE admin_drafts SET slug = ?, title = ?, published = ?, updated = ?, description = ?, ai_summary = ?, image = ?, tags_json = ?, category = ?, lang = ?, pinned = ?, author = ?, source_link = ?, license_name = ?, license_url = ?, comment = ?, content = ?, updated_at = ? WHERE id = ?", draft.slug, draft.title, draft.published, draft.updated ?? null, draft.description ?? "", draft.aiSummary ?? "", draft.image ?? "", JSON.stringify(draft.tags), draft.category ?? "", draft.lang ?? "", draft.pinned ? 1 : 0, draft.author ?? "", draft.sourceLink ?? "", draft.licenseName ?? "", draft.licenseUrl ?? "", draft.comment === false ? 0 : 1, draft.content, now, idOf(context));
		if (!result.meta.changes) return json({ error: "not_found" }, 404);
		await audit(context.env, auth.session.user_id, "draft_update", context.request, { id: idOf(context) });
		return json({ ok: true, draft: await getDraft(context.env, idOf(context)) });
	} catch {
		return json({ error: "draft_update_failed" }, 500);
	}
};

export const onRequestDelete: PagesFunction = async (context) => {
	const denied = requireOrigin(context.request, context.env);
	if (denied) return denied;
	const auth = await requireAuth(context);
	if (auth.response) return auth.response;
	const current = await getDraft(context.env, idOf(context));
	if (!current) return json({ error: "not_found" }, 404);
	if (current.status === "published") return json({ error: "draft_immutable" }, 409);
	const csrf = await requireCsrf(context, auth.session);
	if (csrf) return csrf;
	try {
		const result = await run(context.env.DB, "DELETE FROM admin_drafts WHERE id = ?", idOf(context));
		if (!result.meta.changes) return json({ error: "not_found" }, 404);
		await audit(context.env, auth.session.user_id, "draft_delete", context.request, { id: idOf(context) });
		return json({ ok: true });
	} catch {
		return json({ error: "draft_delete_failed" }, 500);
	}
};
