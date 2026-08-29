import { ApiError } from "../../_shared/errors";
import { adminGet } from "../../_shared/handler";
import { diffSettingsGroup } from "../../_shared/services/settings-service";
import { createLineDiff } from "../../_shared/services/line-diff";

export const onRequestGet = adminGet(async (context) => {
	const key = context.params.key;
	if (typeof key !== "string") throw new ApiError(400, "invalid_request", "参数无效");
	const diff = await diffSettingsGroup(context.env, key);
	return {
		key: diff.key,
		label: diff.label,
		files: diff.files.map((file) => ({
			path: file.path,
			before: file.before,
			after: file.after,
			diff: createLineDiff(file.before, file.after),
		})),
	};
});
