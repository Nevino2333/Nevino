import { readJson } from "./_shared/body";
import { ApiError } from "./_shared/errors";
import {
	compareGitHubCommits,
	decodeGitHubContent,
	getGitHubConfig,
	getGitHubFileAtRef,
} from "./_shared/github";
import { deploymentCallback } from "./_shared/handler";
import { ContentOperationRepository } from "./_shared/repositories/content-operation-repository";
import { PublishTaskRepository } from "./_shared/repositories/publish-task-repository";
import {
	type DeploymentCallbackInput,
	DeploymentCallbackService,
} from "./_shared/services/deployment-callback-service";
import {
	RenameDeploymentService,
	type RenameDeploymentStore,
} from "./_shared/services/rename-deployment-service";
import type { ContentOperationRow } from "./_shared/types";
import type { PublishTaskDto } from "./_shared/contracts";

const CALLBACK_BODY_LIMIT = 4096;

type DeploymentResult = {
	completed: Array<PublishTaskDto | ContentOperationRow>;
	failed: Array<{ taskId: string; code: string }>;
};

export const completeAwaitingOperations = async (
	store: RenameDeploymentStore,
	service: RenameDeploymentService,
	input: Omit<DeploymentCallbackInput, "taskId">,
	compareCommits: (
		base: string,
		head: string,
	) => Promise<"identical" | "ahead" | "behind" | "diverged">,
	result: DeploymentResult,
) => {
	for (const operation of await store.listAwaitingDeployment()) {
		if (!operation.commit_sha) continue;
		try {
			let matches = operation.commit_sha === input.commitSha;
			if (!matches && input.outcome === "success") {
				const status = await compareCommits(operation.commit_sha, input.commitSha);
				matches = status === "identical" || status === "ahead";
			}
			if (!matches) continue;
			result.completed.push(
				await service.complete({
					operationId: operation.id,
					commitSha: operation.commit_sha,
					outcome: input.outcome,
				}),
			);
		} catch (error) {
			result.failed.push({
				taskId: operation.id,
				code:
					error instanceof ApiError
						? error.code
						: "deployment_callback_failed",
			});
		}
	}
};

const parseInput = (
	value: unknown,
): Omit<DeploymentCallbackInput, "taskId"> & { taskId?: string } => {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new ApiError(400, "invalid_request", "部署回调无效");
	const input = value as Record<string, unknown>;
	if (
		(input.taskId !== undefined &&
			(typeof input.taskId !== "string" ||
				input.taskId.length < 1 ||
				input.taskId.length > 128)) ||
		typeof input.commitSha !== "string" ||
		!/^[a-f0-9]{7,64}$/i.test(input.commitSha) ||
		(input.outcome !== "success" && input.outcome !== "failure")
	)
		throw new ApiError(422, "validation_failed", "部署回调校验失败");
	return {
		taskId: input.taskId as string | undefined,
		commitSha: input.commitSha,
		outcome: input.outcome,
	};
};

export const onRequestPost = deploymentCallback(async (context) => {
	const parsed = await readJson(context.request, CALLBACK_BODY_LIMIT);
	if (parsed.response)
		throw new ApiError(
			parsed.response.status,
			"invalid_request",
			"部署回调无效",
		);
	const input = parseInput(parsed.data);
	const repository = new PublishTaskRepository(context.env);
	const operations = new ContentOperationRepository(context.env);
	if (input.taskId) {
		const task = await repository.get(input.taskId);
		if (task)
			return new DeploymentCallbackService(repository).complete({
				...input,
				taskId: task.id,
			});
		const operation = await operations.get(input.taskId);
		if (!operation)
			throw new ApiError(404, "not_found", "发布任务或内容操作不存在");
		const config = getGitHubConfig(context.env);
		if (!config)
			throw new ApiError(503, "github_not_configured", "GitHub 发布未配置");
		return new RenameDeploymentService(operations, {
			getFile: async (path, ref) => {
				try {
					const file = await getGitHubFileAtRef(config, path, ref);
					const content = decodeGitHubContent(file);
					if (content === null)
						throw new ApiError(502, "github_read_failed", "GitHub 文件格式无效");
					return { sha: file.sha, content };
				} catch (error) {
					if (error instanceof ApiError && error.status === 404) return null;
					throw error;
				}
			},
		}).complete({
			operationId: operation.id,
			commitSha: input.commitSha,
			outcome: input.outcome,
		});
	}
	const config = getGitHubConfig(context.env);
	if (!config)
		throw new ApiError(503, "github_not_configured", "GitHub 发布未配置");
	const result = await new DeploymentCallbackService(
		repository,
		undefined,
		(base, head) => compareGitHubCommits(config, base, head),
	).completeAwaiting(input);
	const operationService = new RenameDeploymentService(operations, {
		getFile: async (path, ref) => {
			try {
				const file = await getGitHubFileAtRef(config, path, ref);
				const content = decodeGitHubContent(file);
				if (content === null)
					throw new ApiError(502, "github_read_failed", "GitHub 文件格式无效");
				return { sha: file.sha, content };
			} catch (error) {
				if (error instanceof ApiError && error.status === 404) return null;
				throw error;
			}
		},
	});
	await completeAwaitingOperations(
		operations,
		operationService,
		input,
		(base, head) => compareGitHubCommits(config, base, head),
		result,
	);
	if (result.completed.length === 0 && result.failed.length === 0)
		throw new ApiError(404, "not_found", "发布任务或内容操作不存在");
	return result;
});
