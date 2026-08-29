import { ApiError } from "../../_shared/errors";
import { adminGet } from "../../_shared/handler";
import { settingsHistory } from "../../_shared/services/settings-service";

export const onRequestGet = adminGet(async (context) => {
	const key = context.params.key;
	if (typeof key !== "string") throw new ApiError(400, "invalid_request", "参数无效");
	return { items: await settingsHistory(context.env, key) };
});
