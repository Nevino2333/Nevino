import type {
	DraftDetailDto,
	DraftSummaryDto,
	PublishTaskDto,
} from "../contracts";
import { ApiError } from "../errors";
import type { DraftRow } from "../types";
import { contentCapabilities } from "./content-state";

const tagsOf = (value: string): string[] => {
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed)
			? parsed.filter((tag): tag is string => typeof tag === "string")
			: [];
	} catch {
		return [];
	}
};

export const publicationStateOf = (row: DraftRow) =>
	row.publication_state ?? (row.status === "published" ? "published" : "draft");

export const workspaceStateOf = (row: DraftRow) =>
	row.workspace_state ??
	(row.status === "published" && row.sync_status === "published"
		? "clean"
		: "modified");

export const nextSyncStatus = (row: DraftRow): DraftRow["sync_status"] =>
	publicationStateOf(row) === "published" ? "modified" : "local";

export const assertEditable = (row: DraftRow): void => {
	if (row.sync_status === "publishing")
		throw new ApiError(409, "draft_publishing", "发布中的草稿不可修改");
	if (row.sync_status === "reconciliation_required")
		throw new ApiError(
			409,
			"content_reconciliation_required",
			"文章需要先完成对账",
		);
};

export const assertSlugUnchanged = (row: DraftRow, slug: string): void => {
	if (publicationStateOf(row) === "published" && row.slug !== slug)
		throw new ApiError(
			409,
			"content_slug_immutable",
			"已发布文章必须通过重命名操作修改 slug",
		);
};

export const assertDeletable = (
	row: DraftRow,
	hasPublishTasks: boolean,
	hasOperations: boolean,
): void => {
	const publicationState = publicationStateOf(row);
	if (publicationState === "published")
		throw new ApiError(
			409,
			"content_must_be_withdrawn",
			"已发布文章必须先撤回后删除",
		);
	if (publicationState === "withdrawn")
		throw new ApiError(
			409,
			"content_must_be_withdrawn",
			"撤回文章应使用软删除流程",
		);
	if (hasPublishTasks || hasOperations)
		throw new ApiError(
			409,
			"content_has_history",
			"存在历史任务的内容不可物理删除",
		);
};

export const toSummary = (
	row: Pick<
		DraftRow,
		| "id"
		| "content_id"
		| "slug"
		| "title"
		| "published"
		| "tags_json"
		| "category"
		| "status"
		| "sync_status"
		| "publication_state"
		| "workspace_state"
		| "deployed_commit_sha"
		| "deployed_at"
		| "version"
		| "updated_at"
	>,
): DraftSummaryDto => {
	const publicationState = publicationStateOf(row as DraftRow);
	const workspaceState = workspaceStateOf(row as DraftRow);
	return {
		id: row.id,
		contentId: row.content_id,
		slug: row.slug,
		title: row.title,
		status: row.status,
		syncStatus: row.sync_status,
		publicationState,
		workspaceState:
			workspaceState === "modified" && publicationState === "published"
				? "editing"
				: workspaceState,
		published: row.published,
		tags: tagsOf(row.tags_json),
		category: row.category,
		capabilities: contentCapabilities({
			publicationState,
			workspaceState,
			syncStatus: row.sync_status,
			deployed: Boolean(row.deployed_commit_sha && row.deployed_at),
		}),
		version: row.version,
		updatedAt: row.updated_at,
	};
};

export const toDetail = (
	row: DraftRow,
	publishTask: PublishTaskDto | null = null,
): DraftDetailDto => ({
	...toSummary(row),
	publicationState: publicationStateOf(row),
	workspaceState:
		workspaceStateOf(row) === "modified" &&
		publicationStateOf(row) === "published"
			? "editing"
			: workspaceStateOf(row),
	deployedBlobSha:
		publicationStateOf(row) === "published" ? row.github_sha : null,
	deployedCommitSha: row.deployed_commit_sha ?? null,
	deployedAt: row.deployed_at ?? null,
	capabilities: contentCapabilities({
		publicationState: publicationStateOf(row),
		workspaceState: workspaceStateOf(row),
		syncStatus: row.sync_status,
		deployed: Boolean(
			row.github_sha && row.deployed_commit_sha && row.deployed_at,
		),
	}),
	updated: row.updated,
	description: row.description,
	aiSummary: row.ai_summary,
	image: row.image,
	lang: row.lang,
	pinned: row.pinned === 1,
	author: row.author,
	sourceLink: row.source_link,
	licenseName: row.license_name,
	licenseUrl: row.license_url,
	comment: row.comment === 1,
	content: row.content,
	createdAt: row.created_at,
	githubPath: row.github_path,
	githubSha: row.github_sha,
	commitSha: row.commit_sha,
	publishTask,
});
