import { audit, bestEffortAudit } from "../_shared/audit";
import { readJson } from "../_shared/body";
import { ApiError } from "../_shared/errors";
import { adminGet, adminMutation } from "../_shared/handler";
import {
	discardSpecPage,
	getSpecPage,
	stageSpecPage,
} from "../_shared/services/page-service";

const BODY_LIMIT = 512 * 1024;

export const onRequestGet = adminGet(async (context) => {
	const key = context.params.key;
	if (typeof key !== "string") throw new ApiError(400, "invalid_request", "参数无效");
	return getSpecPage(context.env, key);
});

export const onRequestPut = adminMutation(async (context) => {
	const key = context.params.key;
	if (typeof key !== "string") throw new ApiError(400, "invalid_request", "参数无效");
	const parsed = await readJson(context.request, BODY_LIMIT);
	const body =
		parsed.data && typeof parsed.data === "object"
			? (parsed.data as { content?: unknown; expectedVersion?: unknown })
			: undefined;
	if (!body || typeof body.content !== "string")
		throw new ApiError(422, "validation_failed", "缺少页面内容");
	const detail = await stageSpecPage(
		context.env,
		key,
		body.content,
		typeof body.expectedVersion === "number" ? body.expectedVersion : -1,
		context.session.user_id,
	);
	await bestEffortAudit(() =>
		audit(context.env, context.session.user_id, "page_stage", context.request, {
			requestId: context.requestId,
			resourceType: "page",
			resourceId: key,
			result: "success",
			metadata: { version: detail.version },
		}),
	);
	return detail;
});

export const onRequestDelete = adminMutation(async (context) => {
	const key = context.params.key;
	if (typeof key !== "string") throw new ApiError(400, "invalid_request", "参数无效");
	await discardSpecPage(context.env, key);
	await bestEffortAudit(() =>
		audit(context.env, context.session.user_id, "page_discard", context.request, {
			requestId: context.requestId,
			resourceType: "page",
			resourceId: key,
			result: "success",
		}),
	);
	return { discarded: true };
});
