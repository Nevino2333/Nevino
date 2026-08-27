import { ApiError } from "../errors";
import { parsePostMarkdown } from "../markdown";
import type { ContentRevisionRow, DraftInput, DraftRow } from "../types";
import { publicationStateOf, workspaceStateOf } from "./content-service";

export interface DiscardRevisionStore {
	get(id: string): Promise<DraftRow | null>;
	getDeployedRevision(
		draftId: string,
		commitSha: string,
	): Promise<ContentRevisionRow | null>;
	restoreDeployedSnapshot(
		id: string,
		expectedVersion: number,
		revision: ContentRevisionRow,
		draft: DraftInput,
		now: string,
	): Promise<DraftRow | null>;
}

export class DiscardRevisionService {
	constructor(
		private readonly store: DiscardRevisionStore,
		private readonly now: () => string = () => new Date().toISOString(),
	) {}

	async discard(id: string, expectedVersion: number): Promise<DraftRow> {
		const current = await this.store.get(id);
		if (!current) throw new ApiError(404, "not_found", "文章不存在");
		if (current.version !== expectedVersion)
			throw new ApiError(
				409,
				"content_version_conflict",
				"文章已被其他请求修改",
			);
		if (
			publicationStateOf(current) !== "published" ||
			workspaceStateOf(current) !== "modified" ||
			!current.deployed_commit_sha
		)
			throw new ApiError(
				409,
				"deployed_snapshot_missing",
				"没有可恢复的部署快照",
			);
		const revision = await this.store.getDeployedRevision(
			id,
			current.deployed_commit_sha,
		);
		if (
			!revision ||
			revision.github_commit_sha !== current.deployed_commit_sha ||
			!revision.github_blob_sha
		)
			throw new ApiError(
				409,
				"deployed_snapshot_missing",
				"没有可恢复的部署快照",
			);
		let snapshot: DraftInput;
		try {
			snapshot = parsePostMarkdown(revision.markdown, revision.slug);
		} catch {
			throw new ApiError(409, "deployed_snapshot_invalid", "部署快照无效");
		}
		const restored = await this.store.restoreDeployedSnapshot(
			id,
			expectedVersion,
			revision,
			snapshot,
			this.now(),
		);
		if (!restored)
			throw new ApiError(
				409,
				"content_version_conflict",
				"文章已被其他请求修改",
			);
		return restored;
	}
}
