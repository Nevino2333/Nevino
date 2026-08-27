import { ApiError } from "../errors";
import type { ContentOperationRow } from "../types";

export type RenameDeploymentResult = "completed" | "partial" | "conflict";

export interface RenameDeploymentStore {
	get(id: string): Promise<ContentOperationRow | null>;
	listAwaitingDeployment(): Promise<ContentOperationRow[]>;
	completeRename(
		id: string,
		commitSha: string,
		markdown: string,
		now: string,
	): Promise<RenameDeploymentResult>;
	completeWithdraw?(
		id: string,
		commitSha: string,
		now: string,
	): Promise<RenameDeploymentResult>;
	completeDelete?(
		id: string,
		commitSha: string,
		now: string,
	): Promise<RenameDeploymentResult>;
	completeRollback?(
		id: string,
		commitSha: string,
		markdown: string,
		now: string,
	): Promise<RenameDeploymentResult>;
	markGitHubCommitted(
		id: string,
		now: string,
		blobSha: string | null,
		commitSha: string,
	): Promise<boolean>;
	markDeploymentReconciliationRequired(
		id: string,
		now: string,
		errorCode: string,
	): Promise<boolean>;
}

export interface RenameReconciliationGateway {
	getFile(
		path: string,
		ref: string,
	): Promise<{ sha: string; content: string } | null>;
}

export class RenameDeploymentService {
	constructor(
		private readonly store: RenameDeploymentStore,
		private readonly gateway: RenameReconciliationGateway,
		private readonly now: () => string = () => new Date().toISOString(),
	) {}

	async complete(input: {
		operationId: string;
		commitSha: string;
		outcome: "success" | "failure";
	}): Promise<ContentOperationRow> {
		const operation = await this.store.get(input.operationId);
		if (
			!operation ||
			(operation.type !== "rename" &&
				operation.type !== "withdraw" &&
				operation.type !== "delete" &&
				operation.type !== "rollback")
		)
			throw new ApiError(404, "not_found", "内容操作不存在");
		if (operation.commit_sha !== input.commitSha)
			throw new ApiError(409, "deployment_commit_mismatch", "部署提交不匹配");
		if (input.outcome === "failure") {
			if (operation.status === "reconciliation_required") return operation;
			if (operation.status !== "github_committed")
				throw new ApiError(
					409,
					"deployment_state_conflict",
					"内容操作状态已变化",
				);
			const now = this.now();
			if (
				!(await this.store.markDeploymentReconciliationRequired(
					operation.id,
					now,
					"deployment_build_failed",
				))
			)
				throw new ApiError(
					409,
					"deployment_state_conflict",
					"内容操作状态已变化",
				);
			const current = await this.store.get(operation.id);
			if (current?.status === "reconciliation_required") return current;
			throw new ApiError(
				409,
				"deployment_state_conflict",
				"内容操作恢复状态写入失败",
				true,
			);
		}
		if (operation.status === "completed") return operation;
		if (operation.status !== "github_committed")
			throw new ApiError(
				409,
				"deployment_state_conflict",
				"重命名操作状态已变化",
			);
		const evidencePath =
			operation.type === "delete"
				? operation.source_path
				: operation.target_path;
		if (!evidencePath)
			throw new ApiError(
				409,
				"deployment_state_conflict",
				"内容操作缺少证据路径",
			);
		const remote = await this.gateway.getFile(evidencePath, input.commitSha);
		if (
			operation.type === "delete"
				? remote !== null
				: operation.type === "withdraw"
					? remote !== null
					: !remote || remote.sha !== operation.result_blob_sha
		)
			throw new ApiError(
				409,
				"deployment_commit_mismatch",
				"部署内容证据不匹配",
			);
		const result =
			operation.type === "delete"
				? this.store.completeDelete
					? await this.store.completeDelete(
							operation.id,
							input.commitSha,
							this.now(),
						)
					: "conflict"
				: operation.type === "withdraw"
					? this.store.completeWithdraw
						? await this.store.completeWithdraw(
								operation.id,
								input.commitSha,
								this.now(),
							)
						: "conflict"
					: operation.type === "rollback"
						? this.store.completeRollback
							? await this.store.completeRollback(
									operation.id,
									input.commitSha,
									remote.content,
									this.now(),
								)
							: "conflict"
						: await this.store.completeRename(
								operation.id,
								input.commitSha,
								remote.content,
								this.now(),
							);
		const current = await this.store.get(operation.id);
		if (result === "partial" && current?.status === "reconciliation_required")
			return current;
		if (result !== "completed" || !current || current.status !== "completed")
			throw new ApiError(
				409,
				"deployment_state_conflict",
				"重命名部署收敛失败",
				true,
			);
		return current;
	}

	async reconcile(id: string): Promise<ContentOperationRow> {
		const operation = await this.store.get(id);
		if (
			!operation ||
			(operation.type !== "rename" &&
				operation.type !== "withdraw" &&
				operation.type !== "delete" &&
				operation.type !== "rollback")
		)
			throw new ApiError(404, "not_found", "内容操作不存在");
		if (operation.status === "github_committed") return operation;
		if (
			(operation.status !== "reconciliation_required" &&
				operation.status !== "pending") ||
			!operation.commit_sha
		)
			throw new ApiError(
				409,
				"content_operation_reconciliation_conflict",
				"内容操作不可对账",
			);
		const evidencePath =
			operation.type === "delete"
				? operation.source_path
				: operation.target_path;
		if (!evidencePath)
			throw new ApiError(
				409,
				"content_operation_reconciliation_conflict",
				"内容操作缺少证据路径",
			);
		const remote = await this.gateway.getFile(
			evidencePath,
			operation.commit_sha,
		);
		const evidenceMatches =
			operation.type === "delete"
				? remote === null
				: operation.type === "withdraw"
					? remote === null
					: Boolean(
							remote &&
							operation.result_blob_sha &&
							remote.sha === operation.result_blob_sha,
						);
		if (!evidenceMatches)
			throw new ApiError(
				409,
				"content_operation_reconciliation_conflict",
				"远端内容操作证据不匹配",
			);
		if (
			!(await this.store.markGitHubCommitted(
				operation.id,
				this.now(),
				operation.type === "delete" || operation.type === "withdraw"
					? null
					: (remote?.sha ?? null),
				operation.commit_sha,
			))
		)
			throw new ApiError(
				409,
				"content_operation_reconciliation_conflict",
				"内容操作状态已变化",
				true,
			);
		const current = await this.store.get(id);
		if (current?.status !== "github_committed")
			throw new ApiError(
				500,
				"rename_reconciliation_failed",
				"重命名对账失败",
				true,
			);
		return current;
	}
}
