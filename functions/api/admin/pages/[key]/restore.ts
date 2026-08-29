import { audit, bestEffortAudit } from "../../_shared/audit";
import { readJson } from "../../_shared/body";
import { ApiError } from "../../_shared/errors";
import { adminMutation } from "../../_shared/handler";
import { restoreSpecPageRevision } from "../../_shared/services/page-service";

const BODY_LIMIT = 4096;

export const onRequestPost = adminMutation(async (context) => {
	const key = context.params.key;
	if (typeof key !== "string") throw new ApiError(400, "invalid_request", "参数无效");
	const parsed = await readJson(context.request, BODY_LIMIT);
	const record =
		parsed.data && typeof parsed.data === "object"
			? (parsed.data as { record?: unknown }).record
			: undefined;
	if (typeof record !== "string" || record.length === 0)
		throw new ApiError(400, "invalid_request", "缺少历史记录 ID");
	const detail = await restoreSpecPageRevision(
		context.env,
		key,
		record,
		context.session.user_id,
	);
	await bestEffortAudit(() =>
		audit(context.env, context.session.user_id, "page_restore", context.request, {
			requestId: context.requestId,
			resourceType: "page",
			resourceId: key,
			result: "success",
			metadata: { record },
		}),
	);
	return detail;
});
