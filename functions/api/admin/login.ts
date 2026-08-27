import type { PagesFunction } from "./_shared/types";
import { login, requireOrigin } from "./_shared/auth";
import { readJson } from "./_shared/body";
import { json } from "./_shared/security";

const LOGIN_BODY_LIMIT = 1024;

export const onRequestPost: PagesFunction = async (context) => {
	const denied = requireOrigin(context.request, context.env);
	if (denied) return denied;
	const parsed = await readJson(context.request, LOGIN_BODY_LIMIT);
	if (parsed.response) return parsed.response;
	if (!parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) return json({ error: "invalid_credentials" }, 401);
	const input = parsed.data as Record<string, unknown>;
	const username = typeof input.username === "string" && input.username.length <= 64 ? input.username : "";
	const password = typeof input.password === "string" && input.password.length <= 256 ? input.password : "";
	try {
		return await login(context, username, password);
	} catch {
		return json({ error: "login_failed" }, 500);
	}
};
