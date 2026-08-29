import { audit, bestEffortAudit } from "../../_shared/audit";
import { readJson } from "../../_shared/body";
import { ApiError } from "../../_shared/errors";
import { adminMutation } from "../../_shared/handler";
import { restoreSettingsVersion } from "../../_shared/services/settings-service";

const BODY_LIMIT = 4096;

export const onRequestPost = adminMutation(async (context) => {
	const key = context.params.key;
	if (typeof key !== "string") throw new ApiError(400, "invalid_request", "参数无效");
	const parsed = await readJson(context.request, BODY_LIMIT);
	const historyId =
		parsed.data && typeof parsed.data === "object"
			? (parsed.data as { historyId?: unknown }).historyId
			: undefined;
	if (typeof historyId !== "string" || historyId.length === 0)
		throw new ApiError(400, "invalid_request", "缺少历史版本 ID");
	const detail = await restoreSettingsVersion(
		context.env,
		key,
		historyId,
		context.session.user_id,
	);
	await bestEffortAudit(() =>
		audit(
			context.env,
			context.session.user_id,
			"settings_restore",
			context.request,
			{
				requestId: context.requestId,
				resourceType: "settings",
				resourceId: key,
				result: "success",
				metadata: { historyId },
			},
		),
	);
	return detail;
});
