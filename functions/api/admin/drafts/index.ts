import { audit, bestEffortAudit } from "../_shared/audit";
import { readJson } from "../_shared/body";
import { ApiError } from "../_shared/errors";
import { adminGet, adminMutation } from "../_shared/handler";
import { DraftRepository } from "../_shared/repositories/draft-repository";
import { randomToken } from "../_shared/security";
import { toDetail, toSummary } from "../_shared/services/content-service";
import { parsePostFilters } from "../_shared/services/post-query";
import { validateDraft } from "../_shared/validation";

const DRAFT_BODY_LIMIT = 1024 * 1024;

export const onRequestGet = adminGet(async (context) => {
	const repository = new DraftRepository(context.env);
	const filters = parsePostFilters(new URL(context.request.url));
	const [rows, total] = await Promise.all([
		repository.list(filters),
		repository.count(filters),
	]);
	return {
		items: rows.map(toSummary),
		page: filters.page,
		pageSize: filters.pageSize,
		total,
	};
});

export const onRequestPost = adminMutation(async (context) => {
	const parsed = await readJson(context.request, DRAFT_BODY_LIMIT);
	if (parsed.response)
		throw new ApiError(
			parsed.response.status,
			parsed.response.status === 413 ? "payload_too_large" : "invalid_request",
			"草稿请求无效",
		);
	const checked = validateDraft(parsed.data);
	if (!checked.data)
		throw new ApiError(
			422,
			"validation_failed",
			"草稿校验失败",
			false,
			Object.fromEntries(checked.errors.map((error) => [error, error])),
		);
	const id = randomToken(16);
	const contentId = randomToken(16);
	const draft = await new DraftRepository(context.env).create(
		id,
		contentId,
		checked.data,
		new Date().toISOString(),
	);
	if (!draft)
		throw new ApiError(500, "draft_create_failed", "草稿创建失败", true);
	await bestEffortAudit(() =>
		audit(
			context.env,
			context.session.user_id,
			"draft_create",
			context.request,
			{
				requestId: context.requestId,
				resourceType: "draft",
				resourceId: id,
				result: "success",
				metadata: { version: draft.version },
			},
		),
	);
	return { data: toDetail(draft), status: 201 };
});
