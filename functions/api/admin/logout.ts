import type { PagesFunction } from "./_shared/types";
import { requireAuth, requireCsrf, requireOrigin } from "./_shared/auth";
import { run } from "./_shared/db";
import { cookie, json } from "./_shared/security";
import { audit } from "./_shared/audit";

export const onRequestPost: PagesFunction = async (context) => {
	const denied = requireOrigin(context.request, context.env);
	if (denied) return denied;
	const auth = await requireAuth(context);
	if (auth.response) return auth.response;
	const csrf = await requireCsrf(context, auth.session);
	if (csrf) return csrf;
	await run(context.env.DB, "DELETE FROM admin_sessions WHERE id = ?", auth.session.id);
	await audit(context.env, auth.session.user_id, "logout", context.request);
	return json({ ok: true }, 200, { "Set-Cookie": cookie("admin_session", "", 0, new URL(context.request.url).protocol === "https:") });
};
