import { first, query, run } from "../db";
import type { PostFilters } from "../services/post-query";
import { buildPostQuery } from "../services/post-query";
import type { DraftInput, DraftRow, Env } from "../types";

const detailColumns =
	"id, content_id, slug, title, published, updated, description, ai_summary, image, tags_json, category, lang, pinned, author, source_link, license_name, license_url, comment, content, status, created_at, updated_at, github_path, github_sha, commit_sha, version, sync_status, publication_state, workspace_state, deployed_path, deployed_blob_sha, deployed_commit_sha, deployed_at, deleted_at";
const summaryColumns =
	"id, content_id, slug, title, published, tags_json, category, status, sync_status, version, updated_at, publication_state, workspace_state, deployed_commit_sha, deployed_at";

export class DraftRepository {
	constructor(private readonly env: Env) {}

	async list(filters: PostFilters): Promise<DraftRow[]> {
		const { whereSql, params } = buildPostQuery(filters);
		const result = await query<DraftRow>(
			this.env.DB,
			`SELECT ${summaryColumns} FROM admin_drafts ${whereSql} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
			...params,
			filters.pageSize,
			(filters.page - 1) * filters.pageSize,
		);
		return result.results;
	}

	async count(filters: PostFilters): Promise<number> {
		const { whereSql, params } = buildPostQuery(filters);
		const row = await first<{ total: number }>(
			this.env.DB,
			`SELECT COUNT(*) AS total FROM admin_drafts ${whereSql}`,
			...params,
		);
		return row?.total ?? 0;
	}

	get(id: string): Promise<DraftRow | null> {
		return first<DraftRow>(
			this.env.DB,
			`SELECT ${detailColumns} FROM admin_drafts WHERE id = ?`,
			id,
		);
	}

	findByPath(path: string): Promise<DraftRow | null> {
		return first<DraftRow>(
			this.env.DB,
			`SELECT ${detailColumns} FROM admin_drafts WHERE github_path = ? AND deleted_at IS NULL`,
			path,
		);
	}

	findBySlug(slug: string): Promise<DraftRow | null> {
		return first<DraftRow>(
			this.env.DB,
			`SELECT ${detailColumns} FROM admin_drafts WHERE slug = ? AND deleted_at IS NULL`,
			slug,
		);
	}

	async listBindingsByPaths(paths: string[]): Promise<Map<string, string>> {
		if (!paths.length) return new Map();
		const placeholders = paths.map(() => "?").join(", ");
		const result = await query<Pick<DraftRow, "id" | "github_path">>(
			this.env.DB,
			`SELECT id, github_path FROM admin_drafts WHERE github_path IN (${placeholders}) AND deleted_at IS NULL`,
			...paths,
		);
		return new Map(
			result.results.flatMap((row) =>
				row.github_path ? [[row.github_path, row.id]] : [],
			),
		);
	}

	async create(
		id: string,
		contentId: string,
		draft: DraftInput,
		now: string,
	): Promise<DraftRow | null> {
		await run(
			this.env.DB,
			"INSERT INTO admin_drafts (id, content_id, slug, title, published, updated, description, ai_summary, image, tags_json, category, lang, pinned, author, source_link, license_name, license_url, comment, content, status, created_at, updated_at, version, sync_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'local')",
			id,
			contentId,
			draft.slug,
			draft.title,
			draft.published,
			draft.updated ?? null,
			draft.description ?? "",
			draft.aiSummary ?? "",
			draft.image ?? "",
			JSON.stringify(draft.tags),
			draft.category ?? "",
			draft.lang ?? "",
			draft.pinned ? 1 : 0,
			draft.author ?? "",
			draft.sourceLink ?? "",
			draft.licenseName ?? "",
			draft.licenseUrl ?? "",
			draft.comment === false ? 0 : 1,
			draft.content,
			"draft",
			now,
			now,
		);
		return this.get(id);
	}

	async importPublished(
		draft: DraftRow,
		revision: {
			id: string;
			userId: string;
			markdown: string;
			contentSha256: string;
			operation: import("../types").ContentOperationRow;
		},
	): Promise<DraftRow> {
		const results = await this.env.DB.batch([
			this.env.DB.prepare(
				"INSERT INTO admin_drafts (id, content_id, slug, title, published, updated, description, ai_summary, image, tags_json, category, lang, pinned, author, source_link, license_name, license_url, comment, content, status, created_at, updated_at, github_path, github_sha, commit_sha, version, sync_status, publication_state, workspace_state, deployed_path, deployed_blob_sha, deployed_commit_sha, deployed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, 1, 'published', 'published', 'clean', ?, ?, ?, ?)",
			).bind(
				draft.id,
				draft.content_id,
				draft.slug,
				draft.title,
				draft.published,
				draft.updated,
				draft.description,
				draft.ai_summary,
				draft.image,
				draft.tags_json,
				draft.category,
				draft.lang,
				draft.pinned,
				draft.author,
				draft.source_link,
				draft.license_name,
				draft.license_url,
				draft.comment,
				draft.content,
				draft.created_at,
				draft.updated_at,
				draft.github_path,
				draft.github_sha,
				draft.commit_sha,
				draft.deployed_path ?? draft.github_path,
				draft.deployed_blob_sha ?? draft.github_sha,
				draft.deployed_commit_sha,
				draft.deployed_at,
			),
			this.env.DB.prepare(
				"INSERT INTO admin_content_revisions (id, draft_id, content_id, version, source, title, slug, markdown, content_sha256, github_blob_sha, github_commit_sha, created_by, created_at) VALUES (?, ?, ?, 1, 'import', ?, ?, ?, ?, ?, ?, ?, ?)",
			).bind(
				revision.id,
				draft.id,
				draft.content_id,
				draft.title,
				draft.slug,
				revision.markdown,
				revision.contentSha256,
				draft.github_sha,
				draft.commit_sha,
				revision.userId,
				draft.created_at,
			),
			this.env.DB.prepare(
				"INSERT INTO admin_content_operations (id, idempotency_key, type, status, draft_id, content_id, user_id, expected_version, source_path, target_path, expected_blob_sha, result_blob_sha, commit_sha, content_sha256, source_commit_sha, error_code, created_at, updated_at, completed_at) VALUES (?, ?, 'import', 'completed', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)",
			).bind(
				revision.operation.id,
				revision.operation.idempotency_key,
				draft.id,
				draft.content_id,
				revision.operation.user_id,
				revision.operation.source_path,
				revision.operation.target_path,
				revision.operation.expected_blob_sha,
				revision.operation.result_blob_sha,
				revision.operation.commit_sha,
				revision.operation.content_sha256,
				revision.operation.source_commit_sha,
				revision.operation.created_at,
				revision.operation.updated_at,
				revision.operation.completed_at,
			),
		]);
		if (results.some((result) => result.meta.changes !== 1))
			throw new Error("import_atomic_write_failed");
		return draft;
	}

	async bindPublished(
		id: string,
		expectedVersion: number,
		path: string,
		blobSha: string,
		commitSha: string,
		now: string,
	): Promise<boolean> {
		const result = await run(
			this.env.DB,
			"UPDATE admin_drafts SET sync_status = 'publishing', github_path = ?, github_sha = ?, commit_sha = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?",
			path,
			blobSha,
			commitSha,
			now,
			id,
			expectedVersion,
		);
		return result.meta.changes > 0;
	}

	async update(
		id: string,
		version: number,
		draft: DraftInput,
		now: string,
		revision: {
			id: string;
			userId: string;
			markdown: string;
			contentSha256: string;
			syncStatus: "local" | "modified";
		},
	): Promise<DraftRow | null> {
		const nextVersion = version + 1;
		const results = await this.env.DB.batch([
			this.env.DB.prepare(
				"UPDATE admin_drafts SET slug = ?, title = ?, published = ?, updated = ?, description = ?, ai_summary = ?, image = ?, tags_json = ?, category = ?, lang = ?, pinned = ?, author = ?, source_link = ?, license_name = ?, license_url = ?, comment = ?, content = ?, updated_at = ?, version = version + 1, sync_status = ?, workspace_state = 'modified' WHERE id = ? AND version = ? AND deleted_at IS NULL",
			).bind(
				draft.slug,
				draft.title,
				draft.published,
				draft.updated ?? null,
				draft.description ?? "",
				draft.aiSummary ?? "",
				draft.image ?? "",
				JSON.stringify(draft.tags),
				draft.category ?? "",
				draft.lang ?? "",
				draft.pinned ? 1 : 0,
				draft.author ?? "",
				draft.sourceLink ?? "",
				draft.licenseName ?? "",
				draft.licenseUrl ?? "",
				draft.comment === false ? 0 : 1,
				draft.content,
				now,
				revision.syncStatus,
				id,
				version,
			),
			this.env.DB.prepare(
				"INSERT INTO admin_content_revisions (id, draft_id, content_id, version, source, title, slug, markdown, content_sha256, github_blob_sha, github_commit_sha, created_by, created_at) SELECT ?, id, content_id, ?, 'save', ?, ?, ?, ?, github_sha, deployed_commit_sha, ?, ? FROM admin_drafts WHERE id = ? AND version = ? AND deleted_at IS NULL",
			).bind(
				revision.id,
				nextVersion,
				draft.title,
				draft.slug,
				revision.markdown,
				revision.contentSha256,
				revision.userId,
				now,
				id,
				nextVersion,
			),
		]);
		if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1)
			return null;
		return this.get(id);
	}

	async restoreDeployedSnapshot(
		id: string,
		expectedVersion: number,
		revision: {
			github_blob_sha: string | null;
			github_commit_sha: string | null;
		},
		draft: DraftInput,
		now: string,
	): Promise<DraftRow | null> {
		if (!revision.github_blob_sha || !revision.github_commit_sha) return null;
		const result = await run(
			this.env.DB,
			"UPDATE admin_drafts SET slug = ?, title = ?, published = ?, updated = ?, description = ?, ai_summary = ?, image = ?, tags_json = ?, category = ?, lang = ?, pinned = ?, author = ?, source_link = ?, license_name = ?, license_url = ?, comment = ?, content = ?, status = 'published', publication_state = 'published', workspace_state = 'clean', sync_status = 'published', github_sha = ?, commit_sha = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND deployed_commit_sha = ? AND deleted_at IS NULL",
			draft.slug,
			draft.title,
			draft.published,
			draft.updated ?? null,
			draft.description ?? "",
			draft.aiSummary ?? "",
			draft.image ?? "",
			JSON.stringify(draft.tags ?? []),
			draft.category ?? "",
			draft.lang ?? "",
			draft.pinned ? 1 : 0,
			draft.author ?? "",
			draft.sourceLink ?? "",
			draft.licenseName ?? "",
			draft.licenseUrl ?? "",
			draft.comment === false ? 0 : 1,
			draft.content,
			revision.github_blob_sha,
			revision.github_commit_sha,
			now,
			id,
			expectedVersion,
			revision.github_commit_sha,
		);
		return result.meta.changes === 1 ? this.get(id) : null;
	}

	async softDelete(
		id: string,
		expectedVersion: number,
		now: string,
	): Promise<D1Result<unknown>> {
		return run(
			this.env.DB,
			"UPDATE admin_drafts SET publication_state = 'deleted', deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND publication_state = 'withdrawn' AND deleted_at IS NULL", 
			now,
			now,
			id,
			expectedVersion,
		);
	}

	async delete(id: string): Promise<D1Result<unknown>> {
		const results = await this.env.DB.batch([
			this.env.DB.prepare(
				"DELETE FROM admin_content_revisions WHERE draft_id = ?",
			).bind(id),
			this.env.DB.prepare(
				"DELETE FROM admin_drafts WHERE id = ? AND publication_state = 'draft' AND github_path IS NULL AND deployed_commit_sha IS NULL",
			).bind(id),
		]);
		return results[1];
	}
}
