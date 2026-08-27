import type { PagesFunction } from "./_shared/types";
import { run } from "./_shared/db";
import { hashPassword, json, randomToken, text, timingSafeEqual } from "./_shared/security";
import { readJson } from "./_shared/body";
import { requireOrigin } from "./_shared/auth";

export const onRequestPost: PagesFunction = async (context) => {
	const denied = requireOrigin(context.request, context.env);
	if (denied) return denied;
	const configuredSecret = context.env.ADMIN_BOOTSTRAP_SECRET;
	const requestSecret = context.request.headers.get("X-Admin-Bootstrap-Secret") ?? "";
	if (!configuredSecret || !timingSafeEqual(new TextEncoder().encode(requestSecret), new TextEncoder().encode(configuredSecret))) return json({ error: "forbidden" }, 403);
	try {
		const parsed = await readJson(context.request, 4096);
		if (parsed.response) return json({ error: "invalid_request" }, parsed.response.status);
		const input = parsed.data;
		if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "invalid_request" }, 400);
		const body = input as Record<string, unknown>;
		const username = text(body.username).trim().toLowerCase();
		const password = text(body.password);
		if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{2,63}$/.test(username) || password.length < 12 || password.length > 256) return json({ error: "invalid_credentials" }, 422);
		const passwordHash = await hashPassword(password);
		const id = randomToken(16);
		const createdAt = new Date().toISOString();
		const results = await context.env.DB.batch([
			context.env.DB.prepare("INSERT INTO admin_bootstrap_lock (id, claimed_at) SELECT 1, ? WHERE NOT EXISTS (SELECT 1 FROM admin_users) AND NOT EXISTS (SELECT 1 FROM admin_bootstrap_lock WHERE id = 1)").bind(createdAt),
			context.env.DB.prepare("INSERT INTO admin_users (id, username, password_hash, created_at) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM admin_bootstrap_lock WHERE id = 1 AND claimed_at = ?) AND NOT EXISTS (SELECT 1 FROM admin_users)").bind(id, username, passwordHash, createdAt, createdAt),
		]);
		if (!results[1].meta.changes) return json({ error: "bootstrap_unavailable" }, 409);
		return json({ ok: true, username }, 201);
	} catch {
		return json({ error: "internal_error" }, 500);
	}
};
