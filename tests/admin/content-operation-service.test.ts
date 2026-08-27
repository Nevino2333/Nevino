import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../functions/api/admin/_shared/errors";
import { ContentOperationService } from "../../functions/api/admin/_shared/services/content-operation-service";
import type {
	ContentOperationRow,
	DraftRow,
} from "../../functions/api/admin/_shared/types";

const remote = {
	path: "src/content/posts/hello/index.md",
	blobSha: "blob-1",
	commitSha: "commit-head",
	content: "---\ntitle: Hello\npublished: 2026-08-27\n---\n\n# Hello\n",
};

const publishedDraft = (overrides: Partial<DraftRow> = {}): DraftRow => ({
	id: "draft-1",
	content_id: "content-1",
	slug: "hello",
	title: "Hello",
	published: "2026-08-27",
	updated: null,
	description: "",
	ai_summary: "",
	image: "",
	tags_json: "[]",
	category: "",
	lang: "",
	pinned: 0,
	author: "",
	source_link: "",
	license_name: "",
	license_url: "",
	comment: 1,
	content: "# Hello\n",
	status: "published",
	created_at: "2026-08-27T00:00:00.000Z",
	updated_at: "2026-08-27T00:00:00.000Z",
	github_path: remote.path,
	github_sha: remote.blobSha,
	commit_sha: remote.commitSha,
	version: 4,
	sync_status: "published",
	publication_state: "published",
	workspace_state: "clean",
	deployed_path: remote.path,
	deployed_blob_sha: remote.blobSha,
	deployed_commit_sha: remote.commitSha,
	deployed_at: "2026-08-27T00:00:00.000Z",
	deleted_at: null,
	...overrides,
});

class MemoryStore {
	draft: DraftRow | null = null;
	operation: ContentOperationRow | null = null;
	failRecordCommit = false;
	async getDraft(id: string) {
		return this.draft?.id === id ? this.draft : null;
	}
	async findByIdempotencyKey(key: string) {
		return this.operation?.idempotency_key === key ? this.operation : null;
	}
	async findByPath(path: string) {
		return this.draft?.github_path === path ||
			this.draft?.deployed_path === path
			? this.draft
			: null;
	}
	async findBySlug(slug: string) {
		return this.draft?.slug === slug ? this.draft : null;
	}
	async createPending(row: ContentOperationRow) {
		if (
			this.operation &&
			["pending", "github_committed", "reconciliation_required"].includes(
				this.operation.status,
			)
		)
			throw new Error("active_operation_conflict");
		this.operation = row;
		return row;
	}
	async importPublished(
		row: DraftRow,
		revision: { operation: ContentOperationRow },
	) {
		this.draft = row;
		this.operation = revision.operation;
		return row;
	}
	async markGitHubCommitted(
		id: string,
		now: string,
		blobSha: string | null,
		commitSha: string,
	) {
		if (this.failRecordCommit) throw new Error("d1_failed");
		if (
			!this.operation ||
			this.operation.id !== id ||
			this.operation.status !== "pending"
		)
			return false;
		this.operation = {
			...this.operation,
			status: "github_committed",
			result_blob_sha: blobSha,
			commit_sha: commitSha,
			updated_at: now,
		};
		return true;
	}
	async markReconciliationRequired(
		id: string,
		now: string,
		blobSha: string | null,
		commitSha: string,
		errorCode: string,
	) {
		if (!this.operation || this.operation.id !== id) return false;
		this.operation = {
			...this.operation,
			status: "reconciliation_required",
			result_blob_sha: blobSha,
			commit_sha: commitSha,
			error_code: errorCode,
			updated_at: now,
		};
		return true;
	}
	async markCompleted(
		id: string,
		now: string,
		resultBlobSha: string | null,
		commitSha: string | null,
	) {
		if (!this.operation || this.operation.id !== id) return false;
		this.operation = {
			...this.operation,
			status: "completed",
			result_blob_sha: resultBlobSha,
			commit_sha: commitSha,
			updated_at: now,
			completed_at: now,
		};
		return true;
	}
}

class MemoryGateway {
	writes = 0;
	updateWrites = 0;
	deleteWrites = 0;
	updatedContent = "";
	updatedExpectedBlobSha = "";
	fileSha = remote.blobSha;
	fileContent = remote.content;
	targetExists = false;
	head = remote.commitSha;
	async getHead() {
		return this.head;
	}
	async getFile(path: string, _ref: string) {
		if (path === "src/content/posts/new-name/index.md")
			return this.targetExists
				? { sha: "occupied", content: "occupied" }
				: null;
		assert.equal(path, remote.path);
		return { sha: this.fileSha, content: this.fileContent };
	}
	async updateFile(input: {
		path: string;
		content: string;
		expectedBlobSha: string;
		expectedHeadCommitSha: string;
	}) {
		this.updateWrites += 1;
		this.updatedContent = input.content;
		this.updatedExpectedBlobSha = input.expectedBlobSha;
		return { blobSha: "blob-withdrawn", commitSha: "commit-withdrawn" };
	}
	async deleteFile(input: {
		path: string;
		expectedBlobSha: string;
		expectedHeadCommitSha: string;
	}) {
		this.deleteWrites += 1;
		assert.equal(input.path, remote.path);
		assert.equal(input.expectedBlobSha, remote.blobSha);
		assert.equal(input.expectedHeadCommitSha, remote.commitSha);
		return { blobSha: null, commitSha: "commit-deleted" };
	}
	async renameFile(input: {
		sourcePath: string;
		targetPath: string;
		content: string;
		expectedBlobSha: string;
		expectedHeadCommitSha: string;
	}) {
		this.writes += 1;
		assert.deepEqual(input, {
			sourcePath: remote.path,
			targetPath: "src/content/posts/new-name/index.md",
			content: remote.content,
			expectedBlobSha: remote.blobSha,
			expectedHeadCommitSha: remote.commitSha,
		});
		return { blobSha: "blob-new", commitSha: "commit-new" };
	}
}

const setup = () => {
	const store = new MemoryStore();
	const gateway = new MemoryGateway();
	let sequence = 0;
	return {
		store,
		gateway,
		service: new ContentOperationService({
			store,
			gateway,
			now: () => "2026-08-27T01:00:00.000Z",
			newId: () => `id-${++sequence}`,
		}),
	};
};

const rename = (
	service: ContentOperationService,
	overrides: Record<string, unknown> = {},
) =>
	service.renamePost({
		draftId: "draft-1",
		newSlug: "new-name",
		expectedVersion: 4,
		expectedBlobSha: remote.blobSha,
		idempotencyKey: "rename-hello",
		userId: "user-1",
		...overrides,
	});

test("导入远端 Markdown 建立 published clean 文章与初始 revision，且不写 GitHub", async () => {
	const current = setup();
	const result = await current.service.importPost({
		path: remote.path,
		expectedSha: remote.blobSha,
		idempotencyKey: "import-hello",
		userId: "user-1",
	});
	assert.equal(result.status, "published");
	assert.equal(result.sync_status, "published");
	assert.equal(result.github_path, remote.path);
	assert.equal(result.github_sha, remote.blobSha);
	assert.equal(result.commit_sha, remote.commitSha);
	assert.equal(current.gateway.writes, 0);
});

test("重复导入幂等键返回同一结果，SHA 或路径冲突时拒绝", async () => {
	const current = setup();
	const first = await current.service.importPost({
		path: remote.path,
		expectedSha: remote.blobSha,
		idempotencyKey: "import-hello",
		userId: "user-1",
	});
	assert.equal(
		await current.service.importPost({
			path: remote.path,
			expectedSha: remote.blobSha,
			idempotencyKey: "import-hello",
			userId: "user-1",
		}),
		first,
	);
	await assert.rejects(
		() =>
			current.service.importPost({
				path: remote.path,
				expectedSha: "different",
				idempotencyKey: "import-two",
				userId: "user-1",
			}),
		(error: unknown) =>
			error instanceof ApiError && error.code === "content_already_imported",
	);
});

test("rename 仅允许 published clean synced 且具有完整 deployed 证据", async () => {
	for (const draft of [
		publishedDraft({ publication_state: "draft" }),
		publishedDraft({ workspace_state: "modified" }),
		publishedDraft({ sync_status: "publishing" }),
		publishedDraft({ deployed_path: null }),
		publishedDraft({ deployed_blob_sha: null }),
		publishedDraft({ deployed_commit_sha: null }),
	]) {
		const current = setup();
		current.store.draft = draft;
		await assert.rejects(
			() => rename(current.service),
			(error: unknown) =>
				error instanceof ApiError && error.code === "rename_state_conflict",
		);
		assert.equal(current.gateway.writes, 0);
	}
});

test("rename 校验 slug、version、blob、D1 slug/path 与 GitHub 目标占用后才写入", async () => {
	for (const [overrides, code] of [
		[{ newSlug: "Bad Slug" }, "slug_invalid"],
		[{ expectedVersion: 3 }, "content_version_conflict"],
		[{ expectedBlobSha: "wrong" }, "content_blob_conflict"],
	] as const) {
		const current = setup();
		current.store.draft = publishedDraft();
		await assert.rejects(
			() => rename(current.service, overrides),
			(error: unknown) => error instanceof ApiError && error.code === code,
		);
		assert.equal(current.gateway.writes, 0);
	}
	const occupied = setup();
	occupied.store.draft = publishedDraft();
	occupied.gateway.targetExists = true;
	await assert.rejects(
		() => rename(occupied.service),
		(error: unknown) =>
			error instanceof ApiError && error.code === "rename_target_conflict",
	);
	assert.equal(occupied.gateway.writes, 0);
});

test("rename 使用单次 Git Data 写入并在等待部署期间保留旧 deployed_path 权威", async () => {
	const current = setup();
	current.store.draft = publishedDraft();
	const result = await rename(current.service);
	assert.equal(current.gateway.writes, 1);
	assert.equal(result.status, "github_committed");
	assert.equal(result.commit_sha, "commit-new");
	assert.equal(current.store.draft.deployed_path, remote.path);
	assert.equal(current.store.draft.slug, "hello");
	assert.equal(current.store.draft.version, 4);
});

test("rename 重复幂等请求不重复提交，不同请求复用键或活动操作均冲突", async () => {
	const current = setup();
	current.store.draft = publishedDraft();
	const first = await rename(current.service);
	assert.deepEqual(await rename(current.service), first);
	assert.equal(current.gateway.writes, 1);
	await assert.rejects(
		() => rename(current.service, { newSlug: "another" }),
		(error: unknown) =>
			error instanceof ApiError && error.code === "idempotency_key_conflict",
	);
	await assert.rejects(
		() => rename(current.service, { idempotencyKey: "rename-other" }),
		(error: unknown) =>
			error instanceof ApiError && error.code === "content_operation_active",
	);
});

test("GitHub 成功但 D1 记录失败时保存证据并进入 reconciliation_required", async () => {
	const current = setup();
	current.store.draft = publishedDraft();
	current.store.failRecordCommit = true;
	const result = await rename(current.service);
	assert.equal(result.status, "reconciliation_required");
	assert.equal(result.result_blob_sha, "blob-new");
	assert.equal(result.commit_sha, "commit-new");
	assert.equal(current.store.draft.deployed_path, remote.path);
});

test("withdraw 仅允许 published clean synced，并以 expected blob 将当前远端严格改为 draft", async () => {
	const current = setup();
	current.store.draft = publishedDraft();
	const result = await current.service.withdrawPost({
		draftId: "draft-1",
		expectedVersion: 4,
		idempotencyKey: "withdraw-hello",
		userId: "user-1",
	});
	assert.equal(result.type, "withdraw");
	assert.equal(result.status, "github_committed");
	assert.equal(result.expected_blob_sha, remote.blobSha);
	assert.equal(result.result_blob_sha, null);
	assert.equal(current.gateway.updateWrites, 0);
	assert.equal(current.gateway.deleteWrites, 1);
	assert.equal(current.store.draft.publication_state, "published");
	assert.equal(current.store.draft.workspace_state, "clean");
});

test("withdraw 拒绝非 clean published 状态和远端 blob 冲突", async () => {
	for (const draft of [
		publishedDraft({ publication_state: "withdrawn" }),
		publishedDraft({ workspace_state: "modified" }),
		publishedDraft({ sync_status: "publishing" }),
	]) {
		const current = setup();
		current.store.draft = draft;
		await assert.rejects(
			() =>
				current.service.withdrawPost({
					draftId: "draft-1",
					expectedVersion: 4,
					idempotencyKey: "withdraw-hello",
					userId: "user-1",
				}),
			(error: unknown) =>
				error instanceof ApiError && error.code === "withdraw_state_conflict",
		);
	}
	const conflict = setup();
	conflict.store.draft = publishedDraft();
	conflict.gateway.fileSha = "external-change";
	await assert.rejects(
		() =>
			conflict.service.withdrawPost({
				draftId: "draft-1",
				expectedVersion: 4,
				idempotencyKey: "withdraw-hello",
				userId: "user-1",
			}),
		(error: unknown) =>
			error instanceof ApiError && error.code === "content_blob_conflict",
	);
});

test("withdraw 幂等重放不重复写 GitHub，复用键到不同请求则冲突", async () => {
	const current = setup();
	current.store.draft = publishedDraft();
	const input = {
		draftId: "draft-1",
		expectedVersion: 4,
		idempotencyKey: "withdraw-hello",
		userId: "user-1",
	};
	const first = await current.service.withdrawPost(input);
	assert.deepEqual(await current.service.withdrawPost(input), first);
	assert.equal(current.gateway.deleteWrites, 1);
	await assert.rejects(
		() => current.service.withdrawPost({ ...input, draftId: "draft-2" }),
		(error: unknown) =>
			error instanceof ApiError && error.code === "idempotency_key_conflict",
	);
});
test("delete published/withdrawn 校验部署证据后以 expected SHA 单提交删除并等待部署", async () => {
	for (const publicationState of ["published", "withdrawn"] as const) {
		const current = setup();
		current.store.draft = publishedDraft({
			publication_state: publicationState,
		});
		const result = await current.service.deletePost({
			draftId: "draft-1",
			expectedVersion: 4,
			idempotencyKey: `delete-${publicationState}`,
			userId: "user-1",
		});
		assert.equal(result.type, "delete");
		assert.equal(result.status, "github_committed");
		assert.equal(result.result_blob_sha, null);
		assert.equal(result.commit_sha, "commit-deleted");
		assert.equal(current.gateway.deleteWrites, 1);
		assert.equal(current.store.draft.deleted_at, null);
		assert.notEqual(current.store.draft.publication_state, "deleted");
	}
});

test("delete 远端不存在或 blob 冲突时不提交，幂等重放不重复删除", async () => {
	const conflict = setup();
	conflict.store.draft = publishedDraft();
	conflict.gateway.fileSha = "external-change";
	await assert.rejects(
		() =>
			conflict.service.deletePost({
				draftId: "draft-1",
				expectedVersion: 4,
				idempotencyKey: "delete-hello",
				userId: "user-1",
			}),
		(error: unknown) =>
			error instanceof ApiError && error.code === "content_blob_conflict",
	);
	assert.equal(conflict.gateway.deleteWrites, 0);
	const current = setup();
	current.store.draft = publishedDraft();
	const input = {
		draftId: "draft-1",
		expectedVersion: 4,
		idempotencyKey: "delete-hello",
		userId: "user-1",
	};
	const first = await current.service.deletePost(input);
	assert.deepEqual(await current.service.deletePost(input), first);
	assert.equal(current.gateway.deleteWrites, 1);
});

test("withdraw 使用 GitHub 删除而不是改写 Markdown", async () => {
	const current = setup();
	current.store.draft = publishedDraft();
	await current.service.withdrawPost({ draftId: "draft-1", expectedVersion: 4, idempotencyKey: "withdraw-delete", userId: "user-1" });
	assert.equal(current.gateway.updateWrites, 0);
	assert.equal(current.gateway.deleteWrites, 1);
});