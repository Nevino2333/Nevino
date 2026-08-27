import { first, query, run } from "../db";
import { parsePostMarkdown } from "../markdown";
import type { ContentOperationRow, Env } from "../types";

const columns =
	"id, idempotency_key, type, status, draft_id, content_id, user_id, expected_version, source_path, target_path, expected_blob_sha, result_blob_sha, commit_sha, content_sha256, source_commit_sha, error_code, created_at, updated_at, completed_at";

export class ContentOperationRepository {
	constructor(private readonly env: Env) {}
	get(id: string) {
		return first<ContentOperationRow>(
			this.env.DB,
			`SELECT ${columns} FROM admin_content_operations WHERE id = ?`,
			id,
		);
	}
	listAwaitingDeployment() {
		return this.env.DB.prepare(
			`SELECT ${columns} FROM admin_content_operations WHERE type IN ('rename', 'withdraw', 'delete', 'rollback') AND status = 'github_committed' ORDER BY created_at`,
		)
			.all<ContentOperationRow>()
			.then((result) => result.results);
	}
	async listByContentId(contentId: string) {
		const result = await query<ContentOperationRow>(
			this.env.DB,
			`SELECT ${columns} FROM admin_content_operations WHERE content_id = ? ORDER BY created_at DESC, id DESC`,
			contentId,
		);
		return result.results;
	}
	async existsForDraft(draftId: string) {
		return (
			(await first<{ found: number }>(
				this.env.DB,
				"SELECT 1 AS found FROM admin_content_operations WHERE draft_id = ? LIMIT 1",
				draftId,
			)) !== null
		);
	}

	async hasActiveForDraft(draftId: string) {
		return (
			(await first<{ found: number }>(
				this.env.DB,
				"SELECT 1 AS found FROM admin_content_operations WHERE draft_id = ? AND status IN ('pending', 'github_committed', 'reconciliation_required') LIMIT 1",
				draftId,
			)) !== null
		);
	}
	findByIdempotencyKey(key: string) {
		return first<ContentOperationRow>(
			this.env.DB,
			`SELECT ${columns} FROM admin_content_operations WHERE idempotency_key = ?`,
			key,
		);
	}
	async createPending(row: ContentOperationRow) {
		await run(
			this.env.DB,
			`INSERT INTO admin_content_operations (${columns.replaceAll(", ", ", ")}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			row.id,
			row.idempotency_key,
			row.type,
			row.status,
			row.draft_id,
			row.content_id,
			row.user_id,
			row.expected_version,
			row.source_path,
			row.target_path,
			row.expected_blob_sha,
			row.result_blob_sha,
			row.commit_sha,
			row.content_sha256,
			row.source_commit_sha,
			row.error_code,
			row.created_at,
			row.updated_at,
			row.completed_at,
		);
		return row;
	}
	async markGitHubCommitted(
		id: string,
		now: string,
		resultBlobSha: string | null,
		commitSha: string,
	) {
		const result = await run(
			this.env.DB,
			"UPDATE admin_content_operations SET status = 'github_committed', result_blob_sha = ?, commit_sha = ?, error_code = NULL, updated_at = ? WHERE id = ? AND status IN ('pending', 'reconciliation_required') AND (commit_sha IS NULL OR commit_sha = ?) AND (result_blob_sha IS NULL OR result_blob_sha = ?)",
			resultBlobSha,
			commitSha,
			now,
			id,
			commitSha,
			resultBlobSha,
		);
		return result.meta.changes === 1;
	}
	async markReconciliationRequired(
		id: string,
		now: string,
		resultBlobSha: string | null,
		commitSha: string,
		errorCode: string,
	) {
		const result = await run(
			this.env.DB,
			"UPDATE admin_content_operations SET status = 'reconciliation_required', result_blob_sha = ?, commit_sha = ?, error_code = ?, updated_at = ?, completed_at = NULL WHERE id = ? AND status IN ('pending', 'github_committed', 'reconciliation_required')",
			resultBlobSha,
			commitSha,
			errorCode,
			now,
			id,
		);
		return result.meta.changes === 1;
	}
	async completeRename(
		id: string,
		commitSha: string,
		markdown: string,
		now: string,
	) {
		const operation = await this.get(id);
		if (
			!operation?.draft_id ||
			!operation.target_path ||
			!operation.result_blob_sha ||
			operation.commit_sha !== commitSha
		)
			return "conflict" as const;
		const slug = operation.target_path.split("/")[3] ?? "";
		const results = await this.env.DB.batch([
			this.env.DB.prepare(
				"UPDATE admin_drafts SET slug = ?, github_path = ?, deployed_path = ?, github_sha = ?, deployed_blob_sha = ?, commit_sha = ?, deployed_commit_sha = ?, deployed_at = ?, updated_at = ?, version = version + 1, sync_status = 'published', publication_state = 'published', workspace_state = 'clean' WHERE id = ? AND version = ? AND deployed_path = ? AND deployed_blob_sha = ? AND deployed_commit_sha = ? AND sync_status = 'published' AND workspace_state = 'clean' AND deleted_at IS NULL",
			).bind(
				slug,
				operation.target_path,
				operation.target_path,
				operation.result_blob_sha,
				operation.result_blob_sha,
				commitSha,
				commitSha,
				now,
				now,
				operation.draft_id,
				operation.expected_version,
				operation.source_path,
				operation.expected_blob_sha,
				operation.source_commit_sha,
			),
			this.env.DB.prepare(
				"INSERT INTO admin_content_revisions (id, draft_id, content_id, version, source, title, slug, markdown, content_sha256, github_blob_sha, github_commit_sha, created_by, created_at) SELECT ?, id, content_id, ?, 'rename', title, ?, ?, ?, ?, ?, ?, ? FROM admin_drafts WHERE id = ? AND version = ? AND deployed_commit_sha = ?",
			).bind(
				crypto.randomUUID(),
				operation.expected_version + 1,
				slug,
				markdown,
				operation.content_sha256,
				operation.result_blob_sha,
				commitSha,
				operation.user_id,
				now,
				operation.draft_id,
				operation.expected_version + 1,
				commitSha,
			),
			this.env.DB.prepare(
				"UPDATE admin_content_operations SET status = 'completed', error_code = NULL, updated_at = ?, completed_at = ? WHERE id = ? AND type IN ('rename', 'withdraw', 'delete') AND status = 'github_committed' AND commit_sha = ?",
			).bind(now, now, id, commitSha),
		]);
		if (results.every((result) => result.meta.changes === 1))
			return "completed" as const;
		await run(
			this.env.DB,
			"UPDATE admin_content_operations SET status = 'reconciliation_required', error_code = 'rename_completion_partial', updated_at = ?, completed_at = NULL WHERE id = ? AND type = 'rename' AND status IN ('github_committed', 'completed') AND commit_sha = ?",
			now,
			id,
			commitSha,
		);
		return "partial" as const;
	}
	async completeWithdraw(id: string, commitSha: string, now: string) {
		const operation = await this.get(id);
		if (!operation?.draft_id || operation.commit_sha !== commitSha)
			return "conflict" as const;
		const results = await this.env.DB.batch([
			this.env.DB.prepare(
				"UPDATE admin_drafts SET status = 'draft', publication_state = 'withdrawn', workspace_state = 'clean', sync_status = 'local', github_sha = NULL, deployed_blob_sha = NULL, commit_sha = NULL, deployed_commit_sha = NULL, deployed_at = NULL, deployed_path = NULL, updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND publication_state = 'published' AND workspace_state = 'clean' AND sync_status = 'published' AND deployed_path = ? AND deployed_blob_sha = ? AND deleted_at IS NULL", 
			).bind(
				now,
				operation.draft_id,
				operation.expected_version,
				operation.source_path,
				operation.expected_blob_sha,
			),
			this.env.DB.prepare(
				"UPDATE admin_content_operations SET status = 'completed', error_code = NULL, updated_at = ?, completed_at = ? WHERE id = ? AND type = 'withdraw' AND status = 'github_committed' AND commit_sha = ?",
			).bind(now, now, id, commitSha),
		]);
		if (results.every((result) => result.meta.changes === 1))
			return "completed" as const;
		await run(
			this.env.DB,
			"UPDATE admin_content_operations SET status = 'reconciliation_required', error_code = 'withdraw_completion_partial', updated_at = ?, completed_at = NULL WHERE id = ? AND type = 'withdraw' AND status IN ('github_committed', 'completed') AND commit_sha = ?",
			now,
			id,
			commitSha,
		);
		return "partial" as const;
	}
	async completeDelete(id: string, commitSha: string, now: string) {
		const operation = await this.get(id);
		if (!operation?.draft_id || operation.commit_sha !== commitSha)
			return "conflict" as const;
		const results = await this.env.DB.batch([
			this.env.DB.prepare(
				"UPDATE admin_drafts SET publication_state = 'deleted', deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND publication_state IN ('published', 'withdrawn') AND deployed_path = ? AND deployed_blob_sha = ? AND deleted_at IS NULL",
			).bind(
				now,
				now,
				operation.draft_id,
				operation.expected_version,
				operation.source_path,
				operation.expected_blob_sha,
			),
			this.env.DB.prepare(
				"UPDATE admin_content_operations SET status = 'completed', error_code = NULL, updated_at = ?, completed_at = ? WHERE id = ? AND type = 'delete' AND status = 'github_committed' AND commit_sha = ?",
			).bind(now, now, id, commitSha),
		]);
		if (results.every((result) => result.meta.changes === 1))
			return "completed" as const;
		await run(
			this.env.DB,
			"UPDATE admin_content_operations SET status = 'reconciliation_required', error_code = 'delete_completion_partial', updated_at = ?, completed_at = NULL WHERE id = ? AND type = 'delete' AND status IN ('github_committed', 'completed') AND commit_sha = ?",
			now,
			id,
			commitSha,
		);
		return "partial" as const;
	}
	async completeRollback(
		id: string,
		commitSha: string,
		markdown: string,
		now: string,
	) {
		const operation = await this.get(id);
		if (
			!operation?.draft_id ||
			!operation.target_path ||
			!operation.result_blob_sha ||
			operation.commit_sha !== commitSha
		)
			return "conflict" as const;
		const parsed = parsePostMarkdown(
			markdown,
			operation.target_path.split("/")[3] ?? "",
		);
		const results = await this.env.DB.batch([
			this.env.DB.prepare(
				"UPDATE admin_drafts SET title = ?, published = ?, updated = ?, description = ?, ai_summary = ?, image = ?, tags_json = ?, category = ?, lang = ?, pinned = ?, author = ?, source_link = ?, license_name = ?, license_url = ?, comment = ?, content = ?, github_sha = ?, deployed_blob_sha = ?, commit_sha = ?, deployed_commit_sha = ?, deployed_at = ?, updated_at = ?, version = version + 1, sync_status = 'published', publication_state = 'published', workspace_state = 'clean' WHERE id = ? AND version = ? AND deployed_path = ? AND deployed_blob_sha = ? AND sync_status = 'published' AND workspace_state = 'clean' AND deleted_at IS NULL",
			).bind(
				parsed.title,
				parsed.published,
				parsed.updated ?? null,
				parsed.description ?? "",
				parsed.aiSummary ?? "",
				parsed.image ?? "",
				JSON.stringify(parsed.tags ?? []),
				parsed.category ?? "",
				parsed.lang ?? "",
				parsed.pinned ? 1 : 0,
				parsed.author ?? "",
				parsed.sourceLink ?? "",
				parsed.licenseName ?? "",
				parsed.licenseUrl ?? "",
				parsed.comment === false ? 0 : 1,
				parsed.content,
				operation.result_blob_sha,
				operation.result_blob_sha,
				commitSha,
				commitSha,
				now,
				now,
				operation.draft_id,
				operation.expected_version,
				operation.target_path,
				operation.expected_blob_sha,
			),
			this.env.DB.prepare(
				"INSERT INTO admin_content_revisions (id, draft_id, content_id, version, source, title, slug, markdown, content_sha256, github_blob_sha, github_commit_sha, created_by, created_at) SELECT ?, id, content_id, ?, 'rollback', title, slug, ?, ?, ?, ?, ?, ? FROM admin_drafts WHERE id = ? AND version = ? AND deployed_commit_sha = ?",
			).bind(
				crypto.randomUUID(),
				operation.expected_version + 1,
				markdown,
				operation.content_sha256,
				operation.result_blob_sha,
				commitSha,
				operation.user_id,
				now,
				operation.draft_id,
				operation.expected_version + 1,
				commitSha,
			),
			this.env.DB.prepare(
				"UPDATE admin_content_operations SET status = 'completed', error_code = NULL, updated_at = ?, completed_at = ? WHERE id = ? AND type = 'rollback' AND status = 'github_committed' AND commit_sha = ?",
			).bind(now, now, id, commitSha),
		]);
		if (results.every((result) => result.meta.changes === 1))
			return "completed" as const;
		await run(
			this.env.DB,
			"UPDATE admin_content_operations SET status = 'reconciliation_required', error_code = 'rollback_completion_partial', updated_at = ?, completed_at = NULL WHERE id = ? AND type = 'rollback' AND status IN ('github_committed', 'completed') AND commit_sha = ?",
			now,
			id,
			commitSha,
		);
		return "partial" as const;
	}
	async markDeploymentReconciliationRequired(
		id: string,
		now: string,
		errorCode: string,
	) {
		const result = await run(
			this.env.DB,
			"UPDATE admin_content_operations SET status = 'reconciliation_required', error_code = ?, updated_at = ?, completed_at = NULL WHERE id = ? AND type IN ('rename', 'withdraw', 'delete', 'rollback') AND status = 'github_committed'",
			errorCode,
			now,
			id,
		);
		return result.meta.changes === 1;
	}
	async markCompleted(
		id: string,
		now: string,
		resultBlobSha: string | null,
		commitSha: string | null,
	) {
		const result = await run(
			this.env.DB,
			"UPDATE admin_content_operations SET status = 'completed', result_blob_sha = ?, commit_sha = ?, updated_at = ?, completed_at = ? WHERE id = ? AND status = 'pending'",
			resultBlobSha,
			commitSha,
			now,
			now,
			id,
		);
		return result.meta.changes > 0;
	}
}
