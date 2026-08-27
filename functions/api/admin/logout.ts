import { audit, bestEffortAudit } from "./_shared/audit";
import { run } from "./_shared/db";
import { adminMutation } from "./_shared/handler";
import { cookie } from "./_shared/security";

export const onRequestPost = adminMutation(async (context) => {
	await run(
		context.env.DB,
		"DELETE FROM admin_sessions WHERE id = ?",
		context.session.id,
	);
	await bestEffortAudit(() =>
		audit(context.env, context.session.user_id, "logout", context.request, {
			requestId: context.requestId,
			result: "success",
		}),
	);
	return {
		data: { authenticated: false },
		headers: {
			"Set-Cookie": cookie(
				"admin_session",
				"",
				0,
				new URL(context.request.url).protocol === "https:",
			),
		},
	};
});
