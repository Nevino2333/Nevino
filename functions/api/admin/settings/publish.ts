import { audit, bestEffortAudit } from "../_shared/audit";
import { readJson } from "../_shared/body";
import { adminMutation } from "../_shared/handler";
import { publishSettings } from "../_shared/services/settings-service";

const BODY_LIMIT = 8192;

export const onRequestPost = adminMutation(async (context) => {
	const parsed = await readJson(context.request, BODY_LIMIT);
	let keys: string[] = [];
	if (parsed.data && typeof parsed.data === "object") {
		const raw = (parsed.data as { keys?: unknown }).keys;
		if (Array.isArray(raw))
			keys = raw.filter((item): item is string => typeof item === "string");
	}
	const result = await publishSettings(
		context.env,
		keys,
		context.session.user_id,
	);
	await bestEffortAudit(() =>
		audit(
			context.env,
			context.session.user_id,
			"settings_publish",
			context.request,
			{
				requestId: context.requestId,
				resourceType: "settings",
				resourceId: result.published.map((item) => item.key).join(","),
				result: "success",
				metadata: { commitSha: result.commitSha, keys },
			},
		),
	);
	return { data: result, status: 200 };
});
