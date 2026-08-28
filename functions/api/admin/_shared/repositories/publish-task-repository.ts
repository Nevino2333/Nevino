import { first, run } from "../db";
import type { DeploymentCompletionResult } from "../services/deployment-callback-service";
import type { Env, PublishTaskRow } from "../types";

const columns =
	"id, idempotency_key, draft_id, user_id, expected_version, target_path, content_sha256, status, attempts, github_blob_sha, github_commit_sha, error_code, error_detail, created_at, updated_at, completed_at";

export class PublishTaskRepository {
	constructor(private readonly env: Env) {}

	get(id: string): Promise<PublishTaskRow | null> {
		return first<PublishTaskRow>(
			this.env.DB,
			`SELECT ${columns} FROM admin_publish_tasks WHERE id = ?`,
			id,
		);
	}

	findByIdempotencyKey(key: string): Promise<PublishTaskRow | null> {
		return first<PublishTaskRow>(
			this.env.DB,
			`SELECT ${columns} FROM admin_publish_tasks WHERE idempotency_key = ?`,
			key,
		);
	}

	findAwaitingByCommitSha(commitSha: string): Promise<PublishTaskRow | null> {
		return first<PublishTaskRow>(
			this.env.DB,
			`SELECT ${columns} FROM admin_publish_tasks WHERE github_commit_sha = ? AND status = 'awaiting_deploy' ORDER BY created_at DESC LIMIT 1`,
			commitSha,
		);
	}

	async listAwaitingDeployment(): Promise<PublishTaskRow[]> {
		const result = await this.env.DB.prepare(
			`SELECT ${columns} FROM admin_publish_tasks WHERE status = 'awaiting_deploy' ORDER BY created_at ASC`,
		).all<PublishTaskRow>();
		return result.results;
	}

	findActiveByDraftId(draftId: string): Promise<PublishTaskRow | null> {
		return first<PublishTaskRow>(
			this.env.DB,
			`SELECT ${columns} FROM admin_publish_tasks WHERE draft_id = ? AND status IN ('pending', 'publishing', 'github_committed', 'awaiting_deploy', 'reconciliation_required') ORDER BY created_at DESC LIMIT 1`,
			draftId,
		);
	}

	async existsForDraft(draftId: string): Promise<boolean> {
		const row = await first<{ found: number }>(
			this.env.DB,
			"SELECT 1 AS found FROM admin_publish_tasks WHERE draft_id = ? LIMIT 1",
			draftId,
		);
		return row !== null;
	}

	async create(row: PublishTaskRow): Promise<PublishTaskRow> {
		await run(
			this.env.DB,
			"INSERT INTO admin_publish_tasks (id, idempotency_key, draft_id, user_id, expected_version, target_path, content_sha256, status, attempts, github_blob_sha, github_commit_sha, error_code, error_detail, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			row.id,
			row.idempotency_key,
			row.draft_id,
			row.user_id,
			row.expected_version,
			row.target_path,
			row.content_sha256,
			row.status,
			row.attempts,
			row.github_blob_sha,
			row.github_commit_sha,
			row.error_code,
			row.error_detail,
			row.created_at,
			row.updated_at,
			row.completed_at,
		);
		return row;
	}

	async claim(id: string, now: string): Promise<boolean> {
		const result = await run(
			this.env.DB,
			"UPDATE admin_publish_tasks SET status = 'publishing', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'pending'",
			now,
			id,
		);
		return result.meta.changes > 0;
	}

	async recordGitHubCommit(
		id: string,
		blobSha: string,
		commitSha: string,
		now: string,
	): Promise<boolean> {
		const result = await run(
			this.env.DB,
			"UPDATE admin_publish_tasks SET status = 'github_committed', github_blob_sha = ?, github_commit_sha = ?, updated_at = ? WHERE id = ? AND status = 'publishing'",
			blobSha,
			commitSha,
			now,
			id,
		);
		return result.meta.changes > 0;
	}

	async markReconciliationRequired(
		id: string,
		fromStatus: PublishTaskRow["status"],
		blobSha: string,
		commitSha: string,
		errorCode: string,
		now: string,
	): Promise<boolean> {
		const result = await run(
			this.env.DB,
			"UPDATE admin_publish_tasks SET status = 'reconciliation_required', github_blob_sha = ?, github_commit_sha = ?, error_code = ?, error_detail = ?, updated_at = ? WHERE id = ? AND status = ?",
			blobSha,
			commitSha,
			errorCode,
			errorCode,
			now,
			id,
			fromStatus,
		);
		return result.meta.changes > 0;
	}

	async markAwaitingDeploy(
		id: string,
		fromStatus: PublishTaskRow["status"],
		now: string,
	): Promise<boolean> {
		const result = await run(
			this.env.DB,
			"UPDATE admin_publish_tasks SET status = 'awaiting_deploy', error_code = NULL, error_detail = NULL, updated_at = ? WHERE id = ? AND status = ?",
			now,
			id,
			fromStatus,
		);
		return result.meta.changes > 0;
	}

	async recoverAwaitingDeployment(
		id: string,
		expectedVersion: number,
		commitSha: string,
		now: string,
	): Promise<"recovered" | "partial" | "conflict"> {
		const errorCode = "deployment_wait_recovered";
		const results = await this.env.DB.batch([
			this.env.DB.prepare(
				"UPDATE admin_publish_tasks SET status = 'build_failed', error_code = ?, error_detail = ?, updated_at = ?, completed_at = ? WHERE id = ? AND status = 'awaiting_deploy' AND expected_version = ? AND github_commit_sha = ? AND EXISTS (SELECT 1 FROM admin_drafts WHERE id = admin_publish_tasks.draft_id AND version = admin_publish_tasks.expected_version + 1 AND commit_sha = admin_publish_tasks.github_commit_sha AND sync_status = 'publishing')",
			).bind(errorCode, errorCode, now, now, id, expectedVersion, commitSha),
			this.env.DB.prepare(
				"UPDATE admin_drafts SET status = 'build_failed', sync_status = 'local', updated_at = ? WHERE id = (SELECT draft_id FROM admin_publish_tasks WHERE id = ? AND status = 'build_failed' AND error_code = ? AND updated_at = ? AND expected_version = ? AND github_commit_sha = ?) AND version = ? AND commit_sha = ? AND sync_status = 'publishing'",
			).bind(
				now,
				id,
				errorCode,
				now,
				expectedVersion,
				commitSha,
				expectedVersion + 1,
				commitSha,
			),
			this.env.DB.prepare(
				"SELECT CASE WHEN EXISTS (SELECT 1 FROM admin_publish_tasks task JOIN admin_drafts draft ON draft.id = task.draft_id WHERE task.id = ? AND task.expected_version = ? AND task.github_commit_sha = ? AND task.status = 'build_failed' AND task.error_code = 'deployment_wait_recovered' AND draft.version = ? AND draft.commit_sha = ? AND draft.status = 'build_failed' AND draft.sync_status = 'local') THEN 1 ELSE 0 END AS valid",
			).bind(id, expectedVersion, commitSha, expectedVersion + 1, commitSha),
		]);
		const taskChanges = results[0]?.meta.changes ?? 0;
		const draftChanges = results[1]?.meta.changes ?? 0;
		const valid =
			(results[2]?.results?.[0] as { valid?: number } | undefined)?.valid === 1;
		if (taskChanges === 1 && draftChanges === 1 && valid) return "recovered";
		const partialError = "deployment_recovery_partial";
		const compensation = await run(
			this.env.DB,
			"UPDATE admin_publish_tasks SET status = 'reconciliation_required', error_code = ?, error_detail = ?, updated_at = ?, completed_at = NULL WHERE id = ? AND expected_version = ? AND github_commit_sha = ? AND status IN ('awaiting_deploy', 'build_failed') AND (status = 'awaiting_deploy' OR (error_code = 'deployment_wait_recovered' AND updated_at = ?))",
			partialError,
			partialError,
			now,
			id,
			expectedVersion,
			commitSha,
			now,
		);
		if (compensation.meta.changes === 1) return "partial";
		const current = await this.get(id);
		if (
			current?.expected_version === expectedVersion &&
			current.github_commit_sha === commitSha
		) {
			if (current.status === "build_failed" && current.error_code === errorCode)
				return "recovered";
			if (
				current.status === "reconciliation_required" &&
				current.error_code === partialError
			)
				return "partial";
		}
		return "conflict";
	}

	async completeDeployment(
		id: string,
		commitSha: string,
		expectedVersion: number,
		status: "published" | "build_failed",
		now: string,
	): Promise<DeploymentCompletionResult> {
		const errorCode =
			status === "build_failed" ? "deployment_build_failed" : null;
		// 部署路径与 blob SHA 必须回写到草稿，否则撤回/重命名/删除会被
		// “仅可撤回已部署且同步的文章”状态检查永久阻塞。
		const task = await this.get(id);
		const taskStatement = this.env.DB.prepare(
			"UPDATE admin_publish_tasks SET status = ?, error_code = ?, error_detail = ?, updated_at = ?, completed_at = ? WHERE id = ? AND status = 'awaiting_deploy' AND github_commit_sha = ?",
		).bind(status, errorCode, errorCode, now, now, id, commitSha);
		const draftStatement =
			status === "published"
				? this.env.DB.prepare(
						"UPDATE admin_drafts SET status = 'published', publication_state = 'published', workspace_state = 'clean', sync_status = 'published', deployed_path = ?, deployed_blob_sha = ?, deployed_commit_sha = commit_sha, deployed_at = ?, updated_at = ? WHERE id = (SELECT draft_id FROM admin_publish_tasks WHERE id = ? AND status = 'published' AND github_commit_sha = ?) AND version = ? AND commit_sha = ? AND sync_status = 'publishing'",
					).bind(
						task?.target_path ?? null,
						task?.github_blob_sha ?? null,
						now,
						now,
						id,
						commitSha,
						expectedVersion + 1,
						commitSha,
					)
				: this.env.DB.prepare(
						"UPDATE admin_drafts SET status = 'published', publication_state = 'published', workspace_state = 'modified', sync_status = 'modified', updated_at = ? WHERE id = (SELECT draft_id FROM admin_publish_tasks WHERE id = ? AND status = 'build_failed' AND github_commit_sha = ?) AND version = ? AND commit_sha = ? AND sync_status = 'publishing'",
					).bind(now, id, commitSha, expectedVersion + 1, commitSha);
		const results = await this.env.DB.batch([taskStatement, draftStatement]);
		const taskChanges = results[0]?.meta.changes ?? 0;
		const draftChanges = results[1]?.meta.changes ?? 0;
		if (taskChanges === 1 && draftChanges === 1) return "completed";
		const partialError = "deployment_completion_partial";
		const compensation = await run(
			this.env.DB,
			`UPDATE admin_publish_tasks SET status = 'reconciliation_required', error_code = ?, error_detail = ?, updated_at = ?, completed_at = NULL WHERE id = ? AND expected_version = ? AND github_commit_sha = ? AND status IN ('awaiting_deploy', '${status}') AND (status = 'awaiting_deploy' OR (status = '${status}' AND updated_at = ?))`,
			partialError,
			partialError,
			now,
			id,
			expectedVersion,
			commitSha,
			now,
		);
		if (compensation.meta.changes === 1) return "partial";
		const current = await this.get(id);
		if (
			current?.expected_version === expectedVersion &&
			current.github_commit_sha === commitSha
		) {
			if (current.status === status) return "completed";
			if (
				current.status === "reconciliation_required" &&
				current.error_code === partialError
			)
				return "partial";
		}
		return "conflict";
	}

	async markFailed(
		id: string,
		fromStatus: PublishTaskRow["status"],
		status: "validation_failed" | "content_conflict" | "submit_failed",
		errorCode: string,
		now: string,
	): Promise<boolean> {
		const result = await run(
			this.env.DB,
			"UPDATE admin_publish_tasks SET status = ?, error_code = ?, error_detail = ?, updated_at = ?, completed_at = ? WHERE id = ? AND status = ?",
			status,
			errorCode,
			errorCode,
			now,
			now,
			id,
			fromStatus,
		);
		return result.meta.changes > 0;
	}
}
