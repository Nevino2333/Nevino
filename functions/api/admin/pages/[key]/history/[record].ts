import { ApiError } from "../../../_shared/errors";
import { adminGet } from "../../../_shared/handler";
import { specPageHistoryDetail } from "../../../_shared/services/page-service";

export const onRequestGet = adminGet(async (context) => {
	const key = context.params.key;
	const record = context.params.record;
	if (typeof key !== "string" || typeof record !== "string")
		throw new ApiError(400, "invalid_request", "参数无效");
	return specPageHistoryDetail(context.env, key, record);
});
