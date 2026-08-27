import type { AdminUserRow, DraftRow, Env, SessionRow } from "./types";

export const query = <T = Record<string, unknown>>(
	db: D1Database,
	sql: string,
	...bindings: unknown[]
) =>
	db
		.prepare(sql)
		.bind(...bindings)
		.all<T>();
export const first = async <T = Record<string, unknown>>(
	db: D1Database,
	sql: string,
	...bindings: unknown[]
): Promise<T | null> =>
	(await db
		.prepare(sql)
		.bind(...bindings)
		.first<T>()) ?? null;
export const run = (db: D1Database, sql: string, ...bindings: unknown[]) =>
	db
		.prepare(sql)
		.bind(...bindings)
		.run();
export const getUser = (env: Env, username: string) =>
	first<AdminUserRow>(
		env.DB,
		"SELECT id, username, password_hash, failed_attempts, locked_until FROM admin_users WHERE username = ?",
		username,
	);
export const getUserById = (env: Env, id: string) =>
	first<AdminUserRow>(
		env.DB,
		"SELECT id, username, password_hash, failed_attempts, locked_until FROM admin_users WHERE id = ?",
		id,
	);
export const getSession = (env: Env, id: string) =>
	first<SessionRow>(
		env.DB,
		"SELECT id, user_id, expires_at FROM admin_sessions WHERE id = ? AND expires_at > ?",
		id,
		Date.now(),
	);
export const getDraft = (env: Env, id: string) =>
	first<DraftRow>(
		env.DB,
		"SELECT id, content_id, slug, title, published, updated, description, ai_summary, image, tags_json, category, lang, pinned, author, source_link, license_name, license_url, comment, content, status, created_at, updated_at, github_path, github_sha, commit_sha, version, sync_status FROM admin_drafts WHERE id = ?",
		id,
	);
