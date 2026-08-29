import { audit, bestEffortAudit } from "../_shared/audit";
import { run } from "../_shared/db";
import { ApiError } from "../_shared/errors";
import { adminMutation } from "../_shared/handler";

export const onRequestDelete = adminMutation(async (context) => {
	const id = context.params.id;
	if (typeof id !== "string" || id.length === 0)
		throw new ApiError(400, "invalid_request", "参数无效");
	const result = await run(
		context.env.DB,
		"DELETE FROM admin_sessions WHERE id = ? AND user_id = ?",
		id,
		context.session.user_id,
	);
	if ((result.meta.changes ?? 0) === 0)
		throw new ApiError(404, "not_found", "会话不存在或已失效");
	await bestEffortAudit(() =>
		audit(context.env, context.session.user_id, "session_revoke", context.request, {
			requestId: context.requestId,
			resourceType: "session",
			resourceId: id === context.session.id ? "current" : id,
			result: "success",
		}),
	);
	return { revoked: true, current: id === context.session.id };
});
