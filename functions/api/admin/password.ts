import { audit, bestEffortAudit } from "./_shared/audit";
import { readJson } from "./_shared/body";
import { first, run } from "./_shared/db";
import { ApiError } from "./_shared/errors";
import { adminMutation } from "./_shared/handler";
import { hashPassword, verifyPassword } from "./_shared/security";

const BODY_LIMIT = 4096;

type PasswordChangeBody = {
	current?: unknown;
	next?: unknown;
};

type AdminUserCredentialsRow = {
	id: string;
	username: string;
	password_hash: string;
};

export const onRequestPut = adminMutation(async (context) => {
	const parsed = await readJson(context.request, BODY_LIMIT);
	const body =
		parsed.data && typeof parsed.data === "object"
			? (parsed.data as PasswordChangeBody)
			: undefined;
	const current = typeof body?.current === "string" ? body.current : "";
	const next = typeof body?.next === "string" ? body.next : "";
	if (current.length === 0 || current.length > 256)
		throw new ApiError(422, "validation_failed", "请输入当前的管理员密钥", false, {
			current: "必填",
		});
	if (next.length < 12 || next.length > 256)
		throw new ApiError(422, "validation_failed", "新密钥长度需为 12-256 个字符", false, {
			next: "长度需为 12-256 个字符",
		});
	const user = await first<AdminUserCredentialsRow>(
		context.env.DB,
		"SELECT id, username, password_hash FROM admin_users WHERE id = ?",
		context.session.user_id,
	);
	if (!user) throw new ApiError(401, "unauthorized", "会话已失效");
	if (!(await verifyPassword(current, user.password_hash)))
		throw new ApiError(
			403,
			"password_reauthentication_failed",
			"当前密钥验证失败",
			false,
			{ current: "验证失败" },
		);
	if (await verifyPassword(next, user.password_hash))
		throw new ApiError(422, "validation_failed", "新密钥不能与当前相同", false, {
			next: "不能与当前相同",
		});
	const encoded = await hashPassword(next);
	await run(
		context.env.DB,
		"UPDATE admin_users SET password_hash = ? WHERE id = ?",
		encoded,
		user.id,
	);
	// 其他设备的会话全部吊销，仅保留当前会话
	await run(
		context.env.DB,
		"DELETE FROM admin_sessions WHERE user_id = ? AND id != ?",
		user.id,
		context.session.id,
	);
	await bestEffortAudit(() =>
		audit(context.env, user.id, "password_change", context.request, {
			requestId: context.requestId,
			resourceType: "user",
			resourceId: user.username,
			result: "success",
		}),
	);
	return { updated: true };
});
