import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../functions/api/admin/_shared/errors";
import {
	assertDeletable,
	assertEditable,
	assertSlugUnchanged,
	nextSyncStatus,
	toDetail,
	toSummary,
} from "../../functions/api/admin/_shared/services/content-service";
import type { DraftRow } from "../../functions/api/admin/_shared/types";

const row: DraftRow = {
	id: "draft-1",
	content_id: "content-1",
	slug: "hello-world",
	title: "Hello",
	published: "2026-08-27",
	updated: null,
	description: "Description",
	ai_summary: "Summary",
	image: "/image.webp",
	tags_json: '["astro"]',
	category: "Tech",
	lang: "zh-CN",
	pinned: 1,
	author: "Author",
	source_link: "https://example.com",
	license_name: "CC",
	license_url: "https://example.com/license",
	comment: 1,
	content: "Content",
	status: "draft",
	created_at: "2026-08-27T00:00:00.000Z",
	updated_at: "2026-08-27T01:00:00.000Z",
	github_path: null,
	github_sha: null,
	commit_sha: null,
	version: 3,
	sync_status: "local",
	publication_state: "draft",
	workspace_state: "modified",
	deployed_commit_sha: null,
	deployed_at: null,
	deleted_at: null,
};

test("摘要 DTO 不包含正文并使用 camelCase", () => {
	const summary = toSummary(row);
	assert.deepEqual(summary, {
		id: "draft-1",
		contentId: "content-1",
		slug: "hello-world",
		title: "Hello",
		status: "draft",
		syncStatus: "local",
		publicationState: "draft",
		workspaceState: "modified",
		published: "2026-08-27",
		tags: ["astro"],
		category: "Tech",
		capabilities: {
			editable: true,
			publishable: true,
			renameable: false,
			withdrawable: false,
			deletable: true,
			reconcilable: false,
		},
		version: 3,
		updatedAt: "2026-08-27T01:00:00.000Z",
	});
	assert.equal("content" in summary, false);
});

test("详情 DTO 映射元数据并安全解析标签", () => {
	const detail = toDetail(row);
	assert.equal(detail.aiSummary, "Summary");
	assert.equal(detail.sourceLink, "https://example.com");
	assert.equal(detail.githubSha, null);
	assert.deepEqual(detail.tags, ["astro"]);
	assert.equal(detail.pinned, true);
});

test("草稿存在任何发布任务时禁止删除", () => {
	assert.throws(
		() => assertDeletable(row, true, false),
		(error: unknown) =>
			error instanceof Error &&
			"code" in error &&
			error.code === "content_has_history",
	);
});

test("详情 DTO 可携带活动发布任务供刷新恢复状态", () => {
	const publishTask = {
		id: "task-1",
		draftId: "draft-1",
		expectedVersion: 3,
		targetPath: "src/content/posts/hello-world/index.md",
		status: "awaiting_deploy" as const,
		attempts: 1,
		githubBlobSha: "blob-1",
		githubCommitSha: "commit-1",
		errorCode: null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		completedAt: null,
	};
	assert.deepEqual(toDetail(row, publishTask).publishTask, publishTask);
	assert.equal(toDetail(row, null).publishTask, null);
});

test("publishing 同步期间禁止 PUT 修改草稿", () => {
	assert.throws(
		() => assertEditable({ ...row, sync_status: "publishing" }),
		(error: unknown) =>
			error instanceof ApiError && error.code === "draft_publishing",
	);
	assert.doesNotThrow(() => assertEditable(row));
});

test("已发布 clean 文章可开始修订且保存后进入 editing modified", () => {
	const published = {
		...row,
		status: "published" as const,
		sync_status: "published" as const,
		publication_state: "published" as const,
		workspace_state: "clean" as const,
		github_sha: "deployed-blob",
		commit_sha: "deployed-commit",
		deployed_commit_sha: "deployed-commit",
		deployed_at: "2026-08-27T00:30:00.000Z",
	};
	assert.doesNotThrow(() => assertEditable(published));
	assert.equal(nextSyncStatus(published), "modified");
	assert.equal(toDetail(published).capabilities.editable, true);
	assert.equal(toDetail(published).capabilities.discardable, false);
});

test("已发布文章修订时 slug 不可变", () => {
	assert.doesNotThrow(() => assertSlugUnchanged(row, "renamed"));
	assert.throws(
		() =>
			assertSlugUnchanged(
				{
					...row,
					publication_state: "published",
					workspace_state: "clean",
				},
				"renamed",
			),
		(error: unknown) =>
			error instanceof ApiError && error.code === "content_slug_immutable",
	);
});

test("已发布 editing 详情保留 deployed 证据并允许放弃修订", () => {
	const detail = toDetail({
		...row,
		status: "published",
		sync_status: "modified",
		publication_state: "published",
		workspace_state: "modified",
		github_sha: "deployed-blob",
		commit_sha: "deployed-commit",
		deployed_commit_sha: "deployed-commit",
		deployed_at: "2026-08-27T00:30:00.000Z",
	});
	assert.equal(detail.publicationState, "published");
	assert.equal(detail.workspaceState, "editing");
	assert.equal(detail.syncStatus, "modified");
	assert.equal(detail.deployedBlobSha, "deployed-blob");
	assert.equal(detail.deployedCommitSha, "deployed-commit");
	assert.equal(detail.capabilities.discardable, true);
});

test("从未发布且无历史任务/操作才允许物理删除", () => {
	assert.doesNotThrow(() => assertDeletable(row, false, false));
	for (const [candidate, hasPublishTasks, hasOperations, code] of [
		[row, true, false, "content_has_history"],
		[row, false, true, "content_has_history"],
		[
			{ ...row, publication_state: "published", status: "published" },
			false,
			false,
			"content_must_be_withdrawn",
		],
		[
			{ ...row, publication_state: "withdrawn", status: "published" },
			false,
			false,
			"content_must_be_withdrawn",
		],
	] as const) {
		assert.throws(
			() =>
				assertDeletable(candidate as DraftRow, hasPublishTasks, hasOperations),
			(error: unknown) => error instanceof ApiError && error.code === code,
		);
	}
});
