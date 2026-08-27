import { audit, bestEffortAudit } from "../../_shared/audit";
import { readJson } from "../../_shared/body";
import { ApiError } from "../../_shared/errors";
import {
	commitGitHubRename,
	decodeGitHubContent,
	getGitHubConfig,
	getGitHubFileAtRef,
	getGitHubHead,
} from "../../_shared/github";
import { adminMutation } from "../../_shared/handler";
import { ContentOperationRepository } from "../../_shared/repositories/content-operation-repository";
import { DraftRepository } from "../../_shared/repositories/draft-repository";
import { randomToken } from "../../_shared/security";
import { ContentOperationService } from "../../_shared/services/content-operation-service";

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
		throw new ApiError(400, "invalid_request", "重命名请求无效");
	const body = parsed.data as Record<string, unknown>;
	if (
		typeof body.newSlug !== "string" ||
		typeof body.expectedBlobSha !== "string" ||
		typeof body.idempotencyKey !== "string" ||
		!Number.isSafeInteger(body.expectedVersion) ||
		(body.expectedVersion as number) < 1
	)
		throw new ApiError(422, "validation_failed", "重命名请求校验失败");
	const config = getGitHubConfig(context.env);
	if (!config)
		throw new ApiError(503, "github_not_configured", "GitHub 尚未配置", true);
	const drafts = new DraftRepository(context.env);
	const operations = new ContentOperationRepository(context.env);
	const service = new ContentOperationService({
		store: {
			getDraft: (id) => drafts.get(id),
			findByIdempotencyKey: (key) => operations.findByIdempotencyKey(key),
			findByPath: (path) => drafts.findByPath(path),
			findBySlug: (slug) => drafts.findBySlug(slug),
			createPending: (row) => operations.createPending(row),
			importPublished: (draft, revision) =>
				drafts.importPublished(draft, revision),
			markGitHubCommitted: (id, now, blobSha, commitSha) =>
				operations.markGitHubCommitted(id, now, blobSha, commitSha),
			markReconciliationRequired: (id, now, blobSha, commitSha, errorCode) =>
				operations.markReconciliationRequired(
					id,
					now,
					blobSha,
					commitSha,
					errorCode,
				),
			markCompleted: (id, now, blobSha, commitSha) =>
				operations.markCompleted(id, now, blobSha, commitSha),
		},
		gateway: {
			getHead: () => getGitHubHead(config),
			getFile: async (path, ref) => {
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
			renameFile: async (input) => {
				const result = await commitGitHubRename(
					config,
					input.sourcePath,
					input.targetPath,
					input.content,
					input.expectedHeadCommitSha,
					`Rename post: ${input.sourcePath} -> ${input.targetPath}`,
				);
				if (!result.blobSha)
					throw new ApiError(
						502,
						"github_write_failed",
						"GitHub blob 无效",
						true,
					);
				return { blobSha: result.blobSha, commitSha: result.commitSha };
			},
		},
		now: () => new Date().toISOString(),
		newId: () => randomToken(16),
	});
	const operation = await service.renamePost({
		draftId: idOf(context),
		newSlug: body.newSlug,
		expectedVersion: body.expectedVersion as number,
		expectedBlobSha: body.expectedBlobSha,
		idempotencyKey: body.idempotencyKey,
		userId: context.session.user_id,
	});
	await bestEffortAudit(() =>
		audit(
			context.env,
			context.session.user_id,
			"post_rename",
			context.request,
			{
				requestId: context.requestId,
				resourceType: "content_operation",
				resourceId: operation.id,
				result: "success",
				metadata: {
					oldSlug: operation.source_path?.split("/")[3] ?? null,
					newSlug: body.newSlug,
					operationId: operation.id,
					commitSha: operation.commit_sha,
				},
			},
		),
	);
	return operation;
});
