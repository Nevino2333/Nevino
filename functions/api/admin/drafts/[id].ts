import { audit, bestEffortAudit } from "../_shared/audit";
import { readJson } from "../_shared/body";
import { getUserById } from "../_shared/db";
import { ApiError } from "../_shared/errors";
import {
	commitGitHubDelete,
	decodeGitHubContent,
	getGitHubConfig,
	getGitHubFileAtRef,
	getGitHubHead,
} from "../_shared/github";
import { adminGet, adminMutation } from "../_shared/handler";
import { toMarkdown } from "../_shared/markdown";
import { ContentOperationRepository } from "../_shared/repositories/content-operation-repository";
import { DraftRepository } from "../_shared/repositories/draft-repository";
import { PublishTaskRepository } from "../_shared/repositories/publish-task-repository";
import { randomToken, verifyPassword } from "../_shared/security";
import { ContentOperationService } from "../_shared/services/content-operation-service";
import {
	assertDeletable,
	assertEditable,
	assertSlugUnchanged,
	nextSyncStatus,
	publicationStateOf,
	toDetail,
} from "../_shared/services/content-service";
import { toPublishTaskDto } from "../_shared/services/publish-service";
import { validateDraft } from "../_shared/validation";

const DRAFT_BODY_LIMIT = 1024 * 1024;
const idOf = (context: {
	params: Record<string, string | undefined>;
}): string => context.params.id ?? "";

const sha256 = async (value: string): Promise<string> => {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
};

export const onRequestGet = adminGet(async (context) => {
	const id = idOf(context);
	const draft = await new DraftRepository(context.env).get(id);
	if (!draft) throw new ApiError(404, "not_found", "草稿不存在");
	const task = await new PublishTaskRepository(context.env).findActiveByDraftId(
		id,
	);
	return toDetail(draft, task ? toPublishTaskDto(task) : null);
});

export const onRequestPut = adminMutation(async (context) => {
	const repository = new DraftRepository(context.env);
	const id = idOf(context);
	const current = await repository.get(id);
	if (!current) throw new ApiError(404, "not_found", "草稿不存在");
	assertEditable(current);
	const parsed = await readJson(context.request, DRAFT_BODY_LIMIT);
	if (parsed.response)
		throw new ApiError(
			parsed.response.status,
			parsed.response.status === 413 ? "payload_too_large" : "invalid_request",
			"草稿请求无效",
		);
	if (
		!parsed.data ||
		typeof parsed.data !== "object" ||
		Array.isArray(parsed.data)
	)
		throw new ApiError(400, "invalid_request", "草稿请求无效");
	const version = (parsed.data as Record<string, unknown>).version;
	if (!Number.isSafeInteger(version) || (version as number) < 1)
		throw new ApiError(422, "validation_failed", "草稿校验失败", false, {
			version: "invalid_version",
		});
	const checked = validateDraft(parsed.data);
	if (!checked.data)
		throw new ApiError(
			422,
			"validation_failed",
			"草稿校验失败",
			false,
			Object.fromEntries(checked.errors.map((error) => [error, error])),
		);
	assertSlugUnchanged(current, checked.data.slug);
	const markdown = toMarkdown(
		checked.data,
		publicationStateOf(current) === "published",
	);
	const draft = await repository.update(
		id,
		version as number,
		checked.data,
		new Date().toISOString(),
		{
			id: randomToken(16),
			userId: context.session.user_id,
			markdown,
			contentSha256: await sha256(markdown),
			syncStatus: nextSyncStatus(current),
		},
	);
	if (!draft)
		throw new ApiError(409, "content_version_conflict", "草稿已被其他请求修改");
	await bestEffortAudit(() =>
		audit(
			context.env,
			context.session.user_id,
			"draft_update",
			context.request,
			{
				requestId: context.requestId,
				resourceType: "draft",
				resourceId: id,
				result: "success",
				metadata: { previousVersion: version, version: draft.version },
			},
		),
	);
	return toDetail(draft);
});

export const onRequestDelete = adminMutation(async (context) => {
	const repository = new DraftRepository(context.env);
	const operations = new ContentOperationRepository(context.env);
	const publishTasks = new PublishTaskRepository(context.env);
	const id = idOf(context);
	const current = await repository.get(id);
	if (!current) throw new ApiError(404, "not_found", "文章不存在");
	const parsed = await readJson(context.request, 4096);
	if (
		parsed.response ||
		!parsed.data ||
		typeof parsed.data !== "object" ||
		Array.isArray(parsed.data)
	)
		throw new ApiError(400, "invalid_request", "删除请求无效");
	const body = parsed.data as Record<string, unknown>;
	if (
		!Number.isSafeInteger(body.expectedVersion) ||
		(body.expectedVersion as number) < 1
	)
		throw new ApiError(422, "validation_failed", "删除请求校验失败");
	if (current.version !== body.expectedVersion)
		throw new ApiError(409, "content_version_conflict", "文章已被其他请求修改");
	const hasPublishTasks = await publishTasks.existsForDraft(id);
	const hasOperations = await operations.existsForDraft(id);
	const hasActiveOperations = await operations.hasActiveForDraft(id);
	const publicationState = publicationStateOf(current);
	if (publicationState === "published")
		throw new ApiError(
			409,
			"content_must_be_withdrawn",
			"已发布文章必须先撤回后删除",
		);
	if (publicationState === "withdrawn") {
		if (hasActiveOperations)
			throw new ApiError(409, "content_operation_active", "文章已有活动操作");
		const result = await repository.softDelete(
			id,
			body.expectedVersion as number,
			new Date().toISOString(),
		);
		if (!result.meta.changes)
			throw new ApiError(409, "content_version_conflict", "文章已被其他请求修改");
		await bestEffortAudit(() =>
			audit(
				context.env,
				context.session.user_id,
				"post_delete",
				context.request,
				{
					requestId: context.requestId,
					resourceType: "draft",
					resourceId: id,
					result: "success",
					metadata: { mode: "soft", version: current.version },
				},
			),
		);
		return { deleted: true };
	}
	if (publicationState === "draft") {
		assertDeletable(current, hasPublishTasks, hasOperations);
		const result = await repository.delete(id);
		if (!result.meta.changes)
			throw new ApiError(409, "content_delete_conflict", "文章删除失败");
		await bestEffortAudit(() =>
			audit(
				context.env,
				context.session.user_id,
				"post_delete",
				context.request,
				{
					requestId: context.requestId,
					resourceType: "draft",
					resourceId: id,
					result: "success",
					metadata: { mode: "physical", version: current.version },
				},
			),
		);
		return { deleted: true };
	}
	if (publicationState !== "published" && publicationState !== "withdrawn")
		throw new ApiError(409, "delete_state_conflict", "文章状态不允许删除");
	if (
		typeof body.password !== "string" ||
		typeof body.idempotencyKey !== "string"
	)
		throw new ApiError(
			403,
			"delete_reauthentication_required",
			"删除已发布内容需要重新认证",
		);
	const user = await getUserById(context.env, context.session.user_id);
	if (!user || !(await verifyPassword(body.password, user.password_hash)))
		throw new ApiError(401, "delete_reauthentication_failed", "重新认证失败");
	const activePublish = await publishTasks.findActiveByDraftId(id);
	if (activePublish)
		throw new ApiError(409, "content_operation_active", "文章已有活动操作");
	const config = getGitHubConfig(context.env);
	if (!config)
		throw new ApiError(503, "github_not_configured", "GitHub 尚未配置", true);
	const service = new ContentOperationService({
		store: {
			getDraft: (draftId) => repository.get(draftId),
			findByIdempotencyKey: (key) => operations.findByIdempotencyKey(key),
			findByPath: (path) => repository.findByPath(path),
			findBySlug: (slug) => repository.findBySlug(slug),
			createPending: (row) => operations.createPending(row),
			importPublished: (draft, revision) =>
				repository.importPublished(draft, revision),
			markGitHubCommitted: (operationId, now, blobSha, commitSha) =>
				operations.markGitHubCommitted(operationId, now, blobSha, commitSha),
			markReconciliationRequired: (
				operationId,
				now,
				blobSha,
				commitSha,
				errorCode,
			) =>
				operations.markReconciliationRequired(
					operationId,
					now,
					blobSha,
					commitSha,
					errorCode,
				),
			markCompleted: (operationId, now, blobSha, commitSha) =>
				operations.markCompleted(operationId, now, blobSha, commitSha),
		},
		gateway: {
			getHead: () => getGitHubHead(config),
			getFile: async (path, ref) => {
				try {
					const file = await getGitHubFileAtRef(config, path, ref);
					const markdown = decodeGitHubContent(file);
					if (markdown === null)
						throw new ApiError(
							502,
							"github_read_failed",
							"GitHub 文件格式无效",
						);
					return { sha: file.sha, content: markdown };
				} catch (error) {
					if (error instanceof ApiError && error.status === 404) return null;
					throw error;
				}
			},
			deleteFile: async (input) =>
				commitGitHubDelete(
					config,
					input.path,
					input.expectedHeadCommitSha,
					`Delete ${current.slug}`,
				),
		},
		now: () => new Date().toISOString(),
		newId: () => randomToken(16),
	});
	const operation = await service.deletePost({
		draftId: id,
		expectedVersion: body.expectedVersion as number,
		idempotencyKey: body.idempotencyKey,
		userId: context.session.user_id,
	});
	await bestEffortAudit(() =>
		audit(
			context.env,
			context.session.user_id,
			"post_delete",
			context.request,
			{
				requestId: context.requestId,
				resourceType: "content_operation",
				resourceId: operation.id,
				result: "success",
				metadata: {
					mode: "github",
					operationId: operation.id,
					commitSha: operation.commit_sha,
				},
			},
		),
	);
	return operation;
});
