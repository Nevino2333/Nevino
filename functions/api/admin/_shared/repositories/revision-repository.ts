import { first, query, run } from "../db";
import type { ContentRevisionRow, Env } from "../types";

const summaryColumns =
	"id, draft_id, content_id, version, source, title, slug, content_sha256, github_blob_sha, github_commit_sha, created_by, created_at";

export class RevisionRepository {
	constructor(private readonly env: Env) {}

	async create(row: ContentRevisionRow): Promise<void> {
		await run(
			this.env.DB,
			"INSERT OR IGNORE INTO admin_content_revisions (id, draft_id, content_id, version, source, title, slug, markdown, content_sha256, github_blob_sha, github_commit_sha, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			row.id,
			row.draft_id,
			row.content_id,
			row.version,
			row.source,
			row.title,
			row.slug,
			row.markdown,
			row.content_sha256,
			row.github_blob_sha,
			row.github_commit_sha,
			row.created_by,
			row.created_at,
		);
	}

	async list(draftId: string, limit: number, offset: number) {
		const result = await query<ContentRevisionRow>(
			this.env.DB,
			`SELECT ${summaryColumns} FROM admin_content_revisions WHERE draft_id = ? ORDER BY version DESC LIMIT ? OFFSET ?`,
			draftId,
			limit,
			offset,
		);
		return result.results;
	}

	async listByContentId(contentId: string) {
		const result = await query<ContentRevisionRow>(
			this.env.DB,
			`SELECT ${summaryColumns} FROM admin_content_revisions WHERE content_id = ? ORDER BY created_at DESC, id DESC`,
			contentId,
		);
		return result.results;
	}

	async count(draftId: string): Promise<number> {
		const row = await first<{ total: number }>(
			this.env.DB,
			"SELECT COUNT(*) AS total FROM admin_content_revisions WHERE draft_id = ?",
			draftId,
		);
		return row?.total ?? 0;
	}

	getByVersion(draftId: string, version: number) {
		return first<ContentRevisionRow>(
			this.env.DB,
			`SELECT ${summaryColumns}, markdown FROM admin_content_revisions WHERE draft_id = ? AND version = ?`,
			draftId,
			version,
		);
	}

	getByCommit(draftId: string, commitSha: string) {
		return first<ContentRevisionRow>(
			this.env.DB,
			`SELECT ${summaryColumns}, markdown FROM admin_content_revisions WHERE draft_id = ? AND github_commit_sha = ? ORDER BY version DESC LIMIT 1`,
			draftId,
			commitSha,
		);
	}
}
