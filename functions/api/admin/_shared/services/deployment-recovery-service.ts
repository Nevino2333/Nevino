import type { PublishTaskDto } from "../contracts";
import { ApiError } from "../errors";
import type { PublishTaskRow } from "../types";
import { toPublishTaskDto } from "./publish-service";

export type DeploymentRecoveryResult = "recovered" | "partial" | "conflict";

export interface DeploymentRecoveryStore {
	get(id: string): Promise<PublishTaskRow | null>;
	recoverAwaitingDeployment(
		id: string,
		expectedVersion: number,
		commitSha: string,
		now: string,
	): Promise<DeploymentRecoveryResult>;
}

const isRecovered = (task: PublishTaskRow): boolean =>
	task.status === "build_failed" &&
	task.error_code === "deployment_wait_recovered";

const isPartial = (task: PublishTaskRow): boolean =>
	task.status === "reconciliation_required" &&
	task.error_code === "deployment_recovery_partial";

export class DeploymentRecoveryService {
	constructor(
		private readonly store: DeploymentRecoveryStore,
		private readonly now: () => string = () => new Date().toISOString(),
	) {}

	async recover(id: string): Promise<PublishTaskDto> {
		const task = await this.store.get(id);
		if (!task) throw new ApiError(404, "not_found", "发布任务不存在");
		if (task.status !== "awaiting_deploy")
			throw new ApiError(
				409,
				"deployment_recovery_conflict",
				"仅可解除等待部署的任务",
			);
		if (!task.github_commit_sha)
			throw new ApiError(
				409,
				"deployment_recovery_conflict",
				"等待部署任务缺少提交上下文",
			);
		const result = await this.store.recoverAwaitingDeployment(
			id,
			task.expected_version,
			task.github_commit_sha,
			this.now(),
		);
		const current = await this.store.get(id);
		if (result === "partial" && current && isPartial(current))
			return toPublishTaskDto(current);
		if (result === "conflict")
			throw new ApiError(
				409,
				"deployment_recovery_conflict",
				"发布任务状态已变化",
				true,
			);
		if (!current || !isRecovered(current))
			throw new ApiError(
				500,
				"deployment_recovery_failed",
				"解除部署等待失败",
				true,
			);
		return toPublishTaskDto(current);
	}
}
