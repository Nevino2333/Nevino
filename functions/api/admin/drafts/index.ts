import type { PagesFunction } from "../_shared/types";
import { requireAdminGetOrigin, requireAuth, requireCsrf, requireOrigin } from "../_shared/auth";
import { getDraft, query, run } from "../_shared/db";
import { json, randomToken } from "../_shared/security";
import { readJson } from "../_shared/body";
import { validateDraft } from "../_shared/validation";

const DRAFT_BODY_LIMIT = 1024 * 1024;
import { audit } from "../_shared/audit";

export const onRequestGet: PagesFunction = async (context) => {
	const denied = requireAdminGetOrigin(context.request, context.env);
	if (denied) return denied;
	const auth = await requireAuth(context);
	if (auth.response) return auth.response;
	try {
		const result = await query(context.env.DB, "SELECT * FROM admin_drafts ORDER BY updated_at DESC");
		return json({ drafts: result.results });
	} catch {
		return json({ error: "draft_list_failed" }, 500);
	}
};

export const onRequestPost: PagesFunction = async (context) => {
	const denied = requireOrigin(context.request, context.env);
	if (denied) return denied;
	const auth = await requireAuth(context);
	if (auth.response) return auth.response;
	const csrf = await requireCsrf(context, auth.session);
	if (csrf) return csrf;
	const parsed = await readJson(context.request, DRAFT_BODY_LIMIT);
	if (parsed.response) return json({ error: "invalid_request" }, parsed.response.status);
	const input = parsed.data;
	const checked = validateDraft(input);
	if (!checked.data) return json({ error: "validation_failed", fields: checked.errors }, 422);
	try {
		const draft = checked.data;
		const id = randomToken(16);
		const now = new Date().toISOString();
		await run(context.env.DB, "INSERT INTO admin_drafts (id, slug, title, published, updated, description, ai_summary, image, tags_json, category, lang, pinned, author, source_link, license_name, license_url, comment, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", id, draft.slug, draft.title, draft.published, draft.updated ?? null, draft.description ?? "", draft.aiSummary ?? "", draft.image ?? "", JSON.stringify(draft.tags), draft.category ?? "", draft.lang ?? "", draft.pinned ? 1 : 0, draft.author ?? "", draft.sourceLink ?? "", draft.licenseName ?? "", draft.licenseUrl ?? "", draft.comment === false ? 0 : 1, draft.content, "draft", now, now);
		await audit(context.env, auth.session.user_id, "draft_create", context.request, { id });
		return json({ draft: await getDraft(context.env, id) }, 201);
	} catch {
		return json({ error: "draft_create_failed" }, 500);
	}
};
