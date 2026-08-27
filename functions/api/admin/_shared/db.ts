import type { AdminUser, Draft, Env, Session } from "./types";

export const query = <T = Record<string, unknown>>(db: D1Database, sql: string, ...bindings: unknown[]) => db.prepare(sql).bind(...bindings).all<T>();
export const first = async <T = Record<string, unknown>>(db: D1Database, sql: string, ...bindings: unknown[]): Promise<T | null> => (await db.prepare(sql).bind(...bindings).first<T>()) ?? null;
export const run = (db: D1Database, sql: string, ...bindings: unknown[]) => db.prepare(sql).bind(...bindings).run();
export const getUser = (env: Env, username: string) => first<AdminUser>(env.DB, "SELECT * FROM admin_users WHERE username = ?", username);
export const getSession = (env: Env, id: string) => first<Session>(env.DB, "SELECT * FROM admin_sessions WHERE id = ? AND expires_at > ?", id, Date.now());
export const getDraft = (env: Env, id: string) => first<Draft>(env.DB, "SELECT * FROM admin_drafts WHERE id = ?", id);
