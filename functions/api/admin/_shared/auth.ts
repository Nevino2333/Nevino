import type { Env, PagesContext, Session } from "./types";
import { getSession, getUser, run } from "./db";
import { cookie, parseCookie, randomToken, sha256, verifyPassword, json } from "./security";
import { audit } from "./audit";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DUMMY_PASSWORD_HASH = "pbkdf2$210000$ZHVtbXktc2FsdC1mb3ItbG9naW4$Npj0V8f9E7CYQ8gg1Vk93HO4e6UiZmJe-36XdWmOv3w";

const allowedOrigins = (env: Env): Set<string> => {
	if (!env.ALLOWED_ORIGIN) return new Set();
	try {
		return new Set([new URL(env.ALLOWED_ORIGIN).origin]);
	} catch {
		return new Set();
	}
};

export const originAllowed = (request: Request, env: Env): boolean => {
	const origins = allowedOrigins(env);
	const origin = request.headers.get("Origin");
	if (origin) return origins.has(origin);
	const referer = request.headers.get("Referer");
	if (!referer) return false;
	try {
		return origins.has(new URL(referer).origin);
	} catch {
		return false;
	}
};

export const requireOrigin = (request: Request, env: Env): Response | null => originAllowed(request, env) ? null : json({ error: "forbidden" }, 403);
export const requireAdminGetOrigin = (request: Request, env: Env): Response | null => originAllowed(request, env) ? null : json({ error: "forbidden" }, 403);

export const requireAuth = async (context: PagesContext): Promise<{ session: Session; response: null } | { session: null; response: Response }> => {
	await run(context.env.DB, "DELETE FROM admin_sessions WHERE expires_at <= ?", Date.now());
	const token = parseCookie(context.request, "admin_session");
	if (!token) return { session: null, response: json({ error: "unauthorized" }, 401) };
	const session = await getSession(context.env, await sha256(token));
	return session ? { session, response: null } : { session: null, response: json({ error: "unauthorized" }, 401) };
};

export const csrfToken = async (sessionId: string, secret: string): Promise<string> => sha256(`${secret}:${sessionId}`);
export const requireCsrf = async (context: PagesContext, session: Session): Promise<Response | null> => {
	const expected = await csrfToken(session.id, context.env.SESSION_SECRET);
	return context.request.headers.get("X-CSRF-Token") === expected ? null : json({ error: "csrf_failed" }, 403);
};

const clientIp = (request: Request): string => (request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For")?.split(",")[0] ?? "unknown").trim().slice(0, 128);

export const login = async (context: PagesContext, username: string, password: string): Promise<Response> => {
	const normalizedUsername = username.trim().toLowerCase().slice(0, 64);
	const key = await sha256(`${clientIp(context.request)}\n${normalizedUsername}`);
	const now = Date.now();
	const windowStart = now - LOGIN_WINDOW_MS;
	await run(context.env.DB, "DELETE FROM admin_login_attempts WHERE updated_at < ?", windowStart);
	await run(context.env.DB, "DELETE FROM admin_sessions WHERE expires_at <= ?", now);
	await run(context.env.DB, "INSERT INTO admin_login_attempts (key, failures, window_started_at, locked_until, updated_at) VALUES (?, 0, ?, NULL, ?) ON CONFLICT(key) DO UPDATE SET failures = CASE WHEN admin_login_attempts.window_started_at < ? THEN 0 ELSE admin_login_attempts.failures END, window_started_at = CASE WHEN admin_login_attempts.window_started_at < ? THEN excluded.window_started_at ELSE admin_login_attempts.window_started_at END, locked_until = CASE WHEN admin_login_attempts.window_started_at < ? THEN NULL ELSE admin_login_attempts.locked_until END, updated_at = excluded.updated_at", key, now, now, windowStart, windowStart, windowStart);
	const attempt = await context.env.DB.prepare("SELECT failures, locked_until FROM admin_login_attempts WHERE key = ?").bind(key).first<{ failures: number; locked_until: number | null }>();
	const user = normalizedUsername ? await getUser(context.env, normalizedUsername) : null;
	const verified = await verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
	if (!attempt || (attempt.locked_until !== null && attempt.locked_until > now) || !user || !verified) {
		await run(context.env.DB, "UPDATE admin_login_attempts SET failures = failures + 1, locked_until = CASE WHEN failures + 1 >= ? THEN ? ELSE locked_until END, updated_at = ? WHERE key = ?", LOGIN_MAX_FAILURES, now + LOGIN_WINDOW_MS, now, key);
		return json({ error: "invalid_credentials" }, 401);
	}
	await run(context.env.DB, "DELETE FROM admin_login_attempts WHERE key = ?", key);
	await run(context.env.DB, "UPDATE admin_users SET failed_attempts = 0, locked_until = NULL WHERE id = ?", user.id);
	const token = randomToken(32);
	const sessionId = await sha256(token);
	await run(context.env.DB, "INSERT INTO admin_sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)", sessionId, user.id, now + SESSION_TTL_MS, new Date().toISOString());
	await audit(context.env, user.id, "login", context.request);
	return json({ ok: true }, 200, { "Set-Cookie": cookie("admin_session", token, SESSION_TTL_MS / 1000, new URL(context.request.url).protocol === "https:") });
};
