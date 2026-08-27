import type { Env } from "./types";
import { randomToken } from "./security";
import { run } from "./db";

export const audit = async (env: Env, userId: string | null, action: string, request: Request, metadata: unknown = null): Promise<void> => {
	await run(env.DB, "INSERT INTO admin_audit (id, user_id, action, ip, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)", randomToken(16), userId, action, request.headers.get("CF-Connecting-IP") ?? "", JSON.stringify(metadata), new Date().toISOString());
};
