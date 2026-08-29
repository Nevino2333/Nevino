import { audit, bestEffortAudit } from "../../_shared/audit";
import { ApiError } from "../../_shared/errors";
import { adminMutation } from "../../_shared/handler";
import { publishSpecPage } from "../../_shared/services/page-service";

export const onRequestPost = adminMutation(async (context) => {
	const key = context.params.key;
	if (typeof key !== "string") throw new ApiError(400, "invalid_request", "参数无效");
	const detail = await publishSpecPage(
		context.env,
		key,
		context.session.user_id,
	);
	await bestEffortAudit(() =>
		audit(context.env, context.session.user_id, "page_publish", context.request, {
			requestId: context.requestId,
			resourceType: "page",
			resourceId: key,
			result: "success",
			metadata: {
				commitSha: detail.deployedCommitSha,
				version: detail.version,
			},
		}),
	);
	return detail;
});
