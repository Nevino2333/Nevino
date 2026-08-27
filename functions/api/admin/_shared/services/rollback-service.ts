import { ApiError } from "../errors";
import { isAllowedGitHubPath } from "../github";
import { parsePostMarkdown } from "../markdown";
import type { ContentOperationRow, DraftRow } from "../types";
import { sha256 } from "./content-operation-service";

const validKey = (value: string): boolean =>
	value.length >= 8 && value.length <= 128;

export type RollbackStore = {
	getDraft(id: string): Promise<DraftRow | null>;
	findByIdempotencyKey(key: string): Promise<ContentOperationRow | null>;
	createPending(row: ContentOperationRow): Promise<ContentOperationRow>;
	markGitHubCommitted(
		id: string,
		now: string,
		blobSha: string | null,
		commitSha: string,
	): Promise<boolean>;
	markReconciliationRequired(
		id: string,
		now: string,
		blobSha: string | null,
		commitSha: string,
		errorCode: string,
	): Promise<boolean>;
};

export class RollbackService {
	constructor(
		private readonly dependencies: {
			store: RollbackStore;
			gateway: {
				getHead(): Promise<string>;
				getFile(
					path: string,
					ref: string,
				): Promise<{ sha: string; content: string } | null>;
				updateFile(input: {
					path: string;
					content: string;
					expectedBlobSha: string;
					expectedHeadCommitSha: string;
				}): Promise<{ blobSha: string; commitSha: string }>;
			};
			history: {
				getTrustedCommit(
					contentId: string,
					commitSha: string,
				): Promise<{ path: string; commitSha: string } | null>;
			};
			now: () => string;
			newId: () => string;
		},
	) {}

	async rollback(input: {
		draftId: string;
		sourceCommitSha: string;
		expectedVersion: number;
		expectedBlobSha: string;
		idempotencyKey: string;
		userId: string;
	}): Promise<ContentOperationRow> {
		if (!validKey(input.idempotencyKey))
			throw new ApiError(400, "idempotency_key_invalid", "幂等键无效");
		const existing = await this.dependencies.store.findByIdempotencyKey(
			input.idempotencyKey,
		);
		if (existing) {
			if (
				existing.type === "rollback" &&
				existing.draft_id === input.draftId &&
				existing.expected_version === input.expectedVersion &&
				existing.expected_blob_sha === input.expectedBlobSha &&
				existing.source_commit_sha === input.sourceCommitSha
			)
				return existing;
			throw new ApiError(
				409,
				"idempotency_key_conflict",
				"幂等键已用于其他请求",
			);
		}
		const draft = await this.dependencies.store.getDraft(input.draftId);
		if (!draft) throw new ApiError(404, "not_found", "文章不存在");
		if (draft.version !== input.expectedVersion)
			throw new ApiError(
				409,
				"content_version_conflict",
				"文章已被其他请求修改",
			);
		const path = draft.deployed_path ?? null;
		const blobSha = draft.deployed_blob_sha ?? null;
		const deployedCommit = draft.deployed_commit_sha ?? null;
		if (
			draft.publication_state !== "published" ||
			draft.workspace_state !== "clean" ||
			draft.sync_status !== "published" ||
			!path ||
			!blobSha ||
			!deployedCommit ||
			!draft.deployed_at
		)
			throw new ApiError(
				409,
				"rollback_state_conflict",
				"仅可回滚已部署且同步的文章",
			);
		if (blobSha !== input.expectedBlobSha)
			throw new ApiError(409, "content_blob_conflict", "部署 blob 已变化");
		const trusted = await this.dependencies.history.getTrustedCommit(
			draft.content_id,
			input.sourceCommitSha,
		);
		if (
			!trusted ||
			trusted.commitSha !== input.sourceCommitSha ||
			!isAllowedGitHubPath(trusted.path)
		)
			throw new ApiError(409, "rollback_source_untrusted", "回滚来源不可信");
		const historical = await this.dependencies.gateway.getFile(
			trusted.path,
			trusted.commitSha,
		);
		if (!historical)
			throw new ApiError(404, "history_content_not_found", "历史内容不存在");
		parsePostMarkdown(historical.content, trusted.path.split("/")[3] ?? "");
		const head = await this.dependencies.gateway.getHead();
		if (head !== deployedCommit)
			throw new ApiError(409, "github_head_changed", "GitHub HEAD 已变化");
		const current = await this.dependencies.gateway.getFile(path, head);
		if (!current || current.sha !== blobSha)
			throw new ApiError(409, "content_blob_conflict", "远端内容已变化");
		if (current.content === historical.content)
			throw new ApiError(
				409,
				"content_already_current",
				"历史内容已是当前版本",
			);
		const now = this.dependencies.now();
		const operation: ContentOperationRow = {
			id: this.dependencies.newId(),
			idempotency_key: input.idempotencyKey,
			type: "rollback",
			status: "pending",
			draft_id: draft.id,
			content_id: draft.content_id,
			user_id: input.userId,
			expected_version: input.expectedVersion,
			source_path: trusted.path,
			target_path: path,
			expected_blob_sha: input.expectedBlobSha,
			result_blob_sha: null,
			commit_sha: null,
			content_sha256: await sha256(historical.content),
			source_commit_sha: trusted.commitSha,
			error_code: null,
			created_at: now,
			updated_at: now,
			completed_at: null,
		};
		try {
			await this.dependencies.store.createPending(operation);
		} catch {
			const raced = await this.dependencies.store.findByIdempotencyKey(
				input.idempotencyKey,
			);
			if (raced) return raced;
			throw new ApiError(409, "content_operation_active", "文章已有活动操作");
		}
		const committed = await this.dependencies.gateway.updateFile({
			path,
			content: historical.content,
			expectedBlobSha: blobSha,
			expectedHeadCommitSha: head,
		});
		try {
			if (
				!(await this.dependencies.store.markGitHubCommitted(
					operation.id,
					now,
					committed.blobSha,
					committed.commitSha,
				))
			)
				throw new Error("github_commit_record_failed");
		} catch {
			await this.dependencies.store.markReconciliationRequired(
				operation.id,
				now,
				committed.blobSha,
				committed.commitSha,
				"github_commit_record_failed",
			);
			return {
				...operation,
				status: "reconciliation_required",
				result_blob_sha: committed.blobSha,
				commit_sha: committed.commitSha,
				error_code: "github_commit_record_failed",
			};
		}
		return {
			...operation,
			status: "github_committed",
			result_blob_sha: committed.blobSha,
			commit_sha: committed.commitSha,
		};
	}
}
