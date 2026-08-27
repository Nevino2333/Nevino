import { audit, bestEffortAudit } from "./_shared/audit";
import { readJson } from "./_shared/body";
import { ApiError } from "./_shared/errors";
import { bootstrapMutation } from "./_shared/handler";
import { hashPassword, randomToken, text } from "./_shared/security";

export const onRequestPost = bootstrapMutation(async (context) => {
	const parsed = await readJson(context.request, 4096);
	if (parsed.response)
		throw new ApiError(
			parsed.response.status,
			parsed.response.status === 413 ? "payload_too_large" : "invalid_request",
			"初始化请求无效",
		);
	if (
		!parsed.data ||
		typeof parsed.data !== "object" ||
		Array.isArray(parsed.data)
	)
		throw new ApiError(400, "invalid_request", "初始化请求无效");
	const body = parsed.data as Record<string, unknown>;
	const username = text(body.username).trim().toLowerCase();
	const password = text(body.password);
	if (
		!/^[A-Za-z0-9_][A-Za-z0-9_.-]{2,63}$/.test(username) ||
		password.length < 12 ||
		password.length > 256
	) {
		throw new ApiError(422, "invalid_credentials", "用户名或密码格式无效");
	}
	const passwordHash = await hashPassword(password);
	const id = randomToken(16);
	const createdAt = new Date().toISOString();
	const results = await context.env.DB.batch([
		context.env.DB.prepare(
			"INSERT INTO admin_bootstrap_lock (id, claimed_at) SELECT 1, ? WHERE NOT EXISTS (SELECT 1 FROM admin_users) AND NOT EXISTS (SELECT 1 FROM admin_bootstrap_lock WHERE id = 1)",
		).bind(createdAt),
		context.env.DB.prepare(
			"INSERT INTO admin_users (id, username, password_hash, created_at) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM admin_bootstrap_lock WHERE id = 1 AND claimed_at = ?) AND NOT EXISTS (SELECT 1 FROM admin_users)",
		).bind(id, username, passwordHash, createdAt, createdAt),
	]);
	if (!results[1].meta.changes)
		throw new ApiError(409, "bootstrap_unavailable", "管理员初始化不可用");
	await bestEffortAudit(() =>
		audit(context.env, id, "bootstrap", context.request, {
			requestId: context.requestId,
			resourceType: "admin_user",
			resourceId: id,
			result: "success",
		}),
	);
	return { data: { username }, status: 201 };
});
