import { audit, bestEffortAudit } from "../../_shared/audit";
import { readJson } from "../../_shared/body";
import type { PublishRequestDto } from "../../_shared/contracts";
import { ApiError } from "../../_shared/errors";
import {
	createGitHubFile,
	decodeGitHubContent,
	getGitHubConfig,
	getGitHubFile,
	updateGitHubFile,
} from "../../_shared/github";
import { adminMutation } from "../../_shared/handler";
import { DraftRepository } from "../../_shared/repositories/draft-repository";
import { PublishTaskRepository } from "../../_shared/repositories/publish-task-repository";
import { RevisionRepository } from "../../_shared/repositories/revision-repository";
import { PublishService } from "../../_shared/services/publish-service";

const PUBLISH_BODY_LIMIT = 4096;
const idOf = (context: {
	params: Record<string, string | undefined>;
}): string => context.params.id ?? "";

const parseInput = (value: unknown): PublishRequestDto => {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new ApiError(400, "invalid_request", "发布请求无效");
	const input = value as Record<string, unknown>;
	if (
		typeof input.idempotencyKey !== "string" ||
		input.idempotencyKey.length < 8 ||
		input.idempotencyKey.length > 128 ||
		!Number.isSafeInteger(input.expectedVersion) ||
		(input.expectedVersion as number) < 1
	)
		throw new ApiError(422, "validation_failed", "发布请求校验失败");
	return {
		idempotencyKey: input.idempotencyKey,
		expectedVersion: input.expectedVersion as number,
	};
};

export const onRequestPost = adminMutation(async (context) => {
	const config = getGitHubConfig(context.env);
	if (!config)
		throw new ApiError(503, "github_not_configured", "GitHub 尚未配置", true);
	const parsed = await readJson(context.request, PUBLISH_BODY_LIMIT);
	if (parsed.response)
		throw new ApiError(
			parsed.response.status,
			"invalid_request",
			"发布请求无效",
		);
	const input = parseInput(parsed.data);
	const service = new PublishService({
		drafts: new DraftRepository(context.env),
		tasks: new PublishTaskRepository(context.env),
		revisions: new RevisionRepository(context.env),
		github: {
			async getFile(path) {
				const file = await getGitHubFile(config, path);
				return file
					? { sha: file.sha, content: decodeGitHubContent(file) }
					: null;
			},
			async createFile(path, content, message) {
				const result = await createGitHubFile(config, path, content, message);
				return { blobSha: result.content.sha, commitSha: result.commit.sha };
			},
			async updateFile(path, content, expectedSha, message) {
				const result = await updateGitHubFile(
					config,
					path,
					content,
					expectedSha,
					message,
				);
				return { blobSha: result.content.sha, commitSha: result.commit.sha };
			},
		},
	});
	const task = await service.publish({
		draftId: idOf(context),
		userId: context.session.user_id,
		...input,
	});
	await bestEffortAudit(() =>
		audit(
			context.env,
			context.session.user_id,
			"draft_publish",
			context.request,
			{
				requestId: context.requestId,
				resourceType: "publish_task",
				resourceId: task.id,
				result: "success",
				metadata: { draftId: task.draftId, status: task.status },
			},
		),
	);
	return task;
});
