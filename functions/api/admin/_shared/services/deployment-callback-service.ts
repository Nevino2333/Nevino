import type { PublishTaskDto } from "../contracts";
import { ApiError } from "../errors";
import type { GitHubComparisonStatus } from "../github";
import type { PublishTaskRow } from "../types";

export type DeploymentOutcome = "success" | "failure";

export type DeploymentCallbackInput = {
	taskId: string;
	commitSha: string;
	outcome: DeploymentOutcome;
};

export type DeploymentCompletionResult = "completed" | "partial" | "conflict";

export type DeploymentBatchResult = {
	completed: PublishTaskDto[];
	failed: Array<{ taskId: string; code: string }>;
};

export interface DeploymentTaskStore {
	get(id: string): Promise<PublishTaskRow | null>;
	listAwaitingDeployment(): Promise<PublishTaskRow[]>;
	completeDeployment(
		id: string,
		commitSha: string,
		expectedVersion: number,
		status: "published" | "build_failed",
		now: string,
	): Promise<DeploymentCompletionResult>;
}

const toDto = (row: PublishTaskRow): PublishTaskDto => ({
	id: row.id,
	draftId: row.draft_id,
	expectedVersion: row.expected_version,
	targetPath: row.target_path,
	status: row.status,
	attempts: row.attempts,
	githubBlobSha: row.github_blob_sha,
	githubCommitSha: row.github_commit_sha,
	errorCode: row.error_code,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
	completedAt: row.completed_at,
});

export class DeploymentCallbackService {
	constructor(
		private readonly store: DeploymentTaskStore,
		private readonly now: () => string = () => new Date().toISOString(),
		private readonly compareCommits?: (
			base: string,
			head: string,
		) => Promise<GitHubComparisonStatus>,
	) {}

	async completeAwaiting(
		input: Omit<DeploymentCallbackInput, "taskId">,
	): Promise<DeploymentBatchResult> {
		const awaiting = await this.store.listAwaitingDeployment();
		const result: DeploymentBatchResult = { completed: [], failed: [] };
		for (const task of awaiting) {
			if (!task.github_commit_sha) continue;
			try {
				let matches = task.github_commit_sha === input.commitSha;
				if (!matches && input.outcome === "success" && this.compareCommits) {
					const status = await this.compareCommits(
						task.github_commit_sha,
						input.commitSha,
					);
					matches = status === "identical" || status === "ahead";
				}
				if (!matches) continue;
				result.completed.push(
					await this.complete({
						...input,
						taskId: task.id,
						commitSha: task.github_commit_sha,
					}),
				);
			} catch (error) {
				result.failed.push({
					taskId: task.id,
					code:
						error instanceof ApiError
							? error.code
							: "deployment_callback_failed",
				});
			}
		}
		return result;
	}

	async complete(input: DeploymentCallbackInput): Promise<PublishTaskDto> {
		const task = await this.store.get(input.taskId);
		if (!task) throw new ApiError(404, "not_found", "发布任务不存在");
		if (task.github_commit_sha !== input.commitSha)
			throw new ApiError(409, "deployment_commit_mismatch", "部署提交不匹配");
		const status = input.outcome === "success" ? "published" : "build_failed";
		if (task.status === status) return toDto(task);
		if (task.status !== "awaiting_deploy")
			throw new ApiError(
				409,
				"deployment_state_conflict",
				"发布任务状态已变化",
			);
		const completion = await this.store.completeDeployment(
			task.id,
			input.commitSha,
			task.expected_version,
			status,
			this.now(),
		);
		if (completion === "partial") {
			const current = await this.store.get(task.id);
			if (
				current?.status === "reconciliation_required" &&
				current.github_commit_sha === input.commitSha &&
				current.error_code === "deployment_completion_partial"
			)
				return toDto(current);
			throw new ApiError(
				500,
				"deployment_completion_failed",
				"部署状态更新失败",
				true,
			);
		}
		if (completion === "conflict") {
			const current = await this.store.get(task.id);
			if (
				current?.status === status &&
				current.github_commit_sha === input.commitSha
			)
				return toDto(current);
			throw new ApiError(
				409,
				"deployment_state_conflict",
				"发布任务状态已变化",
				true,
			);
		}
		const completed = await this.store.get(task.id);
		if (!completed)
			throw new ApiError(
				500,
				"deployment_completion_failed",
				"部署状态更新失败",
				true,
			);
		return toDto(completed);
	}
}
