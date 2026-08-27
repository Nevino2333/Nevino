import type { PagesFunction } from "./_shared/types";
import { requireAdminGetOrigin, requireAuth } from "./_shared/auth";
import { csrfToken } from "./_shared/auth";
import { json } from "./_shared/security";

export const onRequestGet: PagesFunction = async (context) => {
	const denied = requireAdminGetOrigin(context.request, context.env);
	if (denied) return denied;
	const auth = await requireAuth(context);
	if (auth.response) return auth.response;
	try {
		return json({ authenticated: true, csrfToken: await csrfToken(auth.session.id, context.env.SESSION_SECRET) });
	} catch {
		return json({ error: "session_failed" }, 500);
	}
};
