import { audit, bestEffortAudit } from "../../_shared/audit";
import { readJson } from "../../_shared/body";
import { getUserById } from "../../_shared/db";
import { ApiError } from "../../_shared/errors";
import {
	decodeGitHubContent,
	getGitHubConfig,
	getGitHubFileAtRef,
	getGitHubHead,
	listGitHubFileHistory,
	commitGitHubUpdate,
} from "../../_shared/github";
import { adminMutation } from "../../_shared/handler";
import { ContentOperationRepository } from "../../_shared/repositories/content-operation-repository";
import { DraftRepository } from "../../_shared/repositories/draft-repository";
import { PublishTaskRepository } from "../../_shared/repositories/publish-task-repository";
import { randomToken, verifyPassword } from "../../_shared/security";
import { RollbackService } from "../../_shared/services/rollback-service";

const idOf = (context: {
	params: Record<string, string | undefined>;
}): string => context.params.id ?? "";

export const onRequestPost = adminMutation(async (context) => {
	const parsed = await readJson(context.request, 4096);
	if (
		parsed.response ||
		!parsed.data ||
		typeof parsed.data !== "object" ||
		Array.isArray(parsed.data)
	)
		throw new ApiError(400, "invalid_request", "回滚请求无效");
	const body = parsed.data as Record<string, unknown>;
	if (
		typeof body.password !== "string" ||
		typeof body.sourceCommitSha !== "string" ||
		typeof body.expectedBlobSha !== "string" ||
		typeof body.idempotencyKey !== "string" ||
		!Number.isSafeInteger(body.expectedVersion) ||
		(body.expectedVersion as number) < 1
	)
		throw new ApiError(422, "validation_failed", "回滚请求校验失败");
	const user = await getUserById(context.env, context.session.user_id);
	if (!user || !(await verifyPassword(body.password, user.password_hash)))
		throw new ApiError(401, "rollback_reauthentication_failed", "重新认证失败");
	const draftId = idOf(context);
	if (await new PublishTaskRepository(context.env).findActiveByDraftId(draftId))
		throw new ApiError(409, "content_operation_active", "文章已有活动操作");
	const config = getGitHubConfig(context.env);
	if (!config)
		throw new ApiError(503, "github_not_configured", "GitHub 尚未配置", true);
	const drafts = new DraftRepository(context.env);
	const operations = new ContentOperationRepository(context.env);
	const service = new RollbackService({
		store: {
			getDraft: (id) => drafts.get(id),
			findByIdempotencyKey: (key) => operations.findByIdempotencyKey(key),
			createPending: (row) => operations.createPending(row),
			markGitHubCommitted: (id, now, blob, commit) =>
				operations.markGitHubCommitted(id, now, blob, commit),
			markReconciliationRequired: (id, now, blob, commit, code) =>
				operations.markReconciliationRequired(id, now, blob, commit, code),
		},
		gateway: {
			getHead: () => getGitHubHead(config),
			async getFile(path, ref) {
				try {
					const file = await getGitHubFileAtRef(config, path, ref);
					const content = decodeGitHubContent(file);
					if (content === null)
						throw new ApiError(
							502,
							"github_read_failed",
							"GitHub 文件格式无效",
						);
					return { sha: file.sha, content };
				} catch (error) {
					if (error instanceof ApiError && error.status === 404) return null;
					throw error;
				}
			},
			async updateFile(input) {
				const result = await commitGitHubUpdate(
					config,
					input.path,
					input.content,
					input.expectedBlobSha,
					input.expectedHeadCommitSha,
					`Rollback ${input.path.split("/")[3] ?? "post"} to ${body.sourceCommitSha.slice(0, 7)}`,
				);
				return { blobSha: result.blobSha as string, commitSha: result.commitSha };
			},
		},
		history: {
			async getTrustedCommit(_contentId, commitSha) {
				const draft = await drafts.get(draftId);
				if (!draft) return null;
				const paths = [
					...new Set(
						[
							draft.deployed_path,
							draft.github_path,
							...(await operations.listByContentId(draft.content_id)).flatMap(
								(row) => [row.source_path, row.target_path],
							),
						].filter((path): path is string => Boolean(path)),
					),
				];
				for (const path of paths) {
					if (
						(await listGitHubFileHistory(config, path, 1, 50)).some(
							(item) => item.sha === commitSha,
						)
					)
						return { path, commitSha };
				}
				return null;
			},
		},
		now: () => new Date().toISOString(),
		newId: () => randomToken(16),
	});
	const operation = await service.rollback({
		draftId,
		sourceCommitSha: body.sourceCommitSha,
		expectedVersion: body.expectedVersion as number,
		expectedBlobSha: body.expectedBlobSha,
		idempotencyKey: body.idempotencyKey,
		userId: context.session.user_id,
	});
	await bestEffortAudit(() =>
		audit(
			context.env,
			context.session.user_id,
			"post_rollback",
			context.request,
			{
				requestId: context.requestId,
				resourceType: "content_operation",
				resourceId: operation.id,
				result: "success",
				metadata: {
					sourceCommitSha: operation.source_commit_sha,
					resultCommitSha: operation.commit_sha,
					operationId: operation.id,
				},
			},
		),
	);
	return operation;
});
