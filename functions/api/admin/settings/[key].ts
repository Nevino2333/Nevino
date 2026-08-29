import { audit, bestEffortAudit } from "../_shared/audit";
import { readJson } from "../_shared/body";
import type { JsonLikeValue } from "../_shared/config/registry";
import { ApiError } from "../_shared/errors";
import { adminGet, adminMutation } from "../_shared/handler";
import {
	discardSettingsGroup,
	getSettingsGroup,
	stageSettingsGroup,
} from "../_shared/services/settings-service";

const BODY_LIMIT = 512 * 1024;

type StageBody = {
	values?: Record<string, JsonLikeValue>;
	code?: Record<string, string>;
	expectedVersion?: number;
};

export const onRequestGet = adminGet(async (context) => {
	const key = context.params.key;
	if (typeof key !== "string") throw new ApiError(400, "invalid_request", "参数无效");
	return getSettingsGroup(context.env, key);
});

export const onRequestPut = adminMutation(async (context) => {
	const key = context.params.key;
	if (typeof key !== "string") throw new ApiError(400, "invalid_request", "参数无效");
	const parsed = await readJson(context.request, BODY_LIMIT);
	if (!parsed.data || typeof parsed.data !== "object")
		throw new ApiError(400, "invalid_request", "请求体无效");
	const body = parsed.data as StageBody;
	if (!body.values || typeof body.values !== "object")
		throw new ApiError(422, "validation_failed", "缺少字段值", false, {
			values: "缺少字段值",
		});
	const detail = await stageSettingsGroup(
		context.env,
		{
			key,
			values: body.values,
			code: typeof body.code === "object" && body.code !== null ? body.code : undefined,
			expectedVersion:
				typeof body.expectedVersion === "number" ? body.expectedVersion : -1,
		},
		context.session.user_id,
	);
	await bestEffortAudit(() =>
		audit(
			context.env,
			context.session.user_id,
			"settings_stage",
			context.request,
			{
				requestId: context.requestId,
				resourceType: "settings",
				resourceId: key,
				result: "success",
				metadata: { version: detail.version },
			},
		),
	);
	return detail;
});

export const onRequestDelete = adminMutation(async (context) => {
	const key = context.params.key;
	if (typeof key !== "string") throw new ApiError(400, "invalid_request", "参数无效");
	await discardSettingsGroup(context.env, key);
	await bestEffortAudit(() =>
		audit(
			context.env,
			context.session.user_id,
			"settings_discard",
			context.request,
			{
				requestId: context.requestId,
				resourceType: "settings",
				resourceId: key,
				result: "success",
			},
		),
	);
	return { discarded: true };
});
