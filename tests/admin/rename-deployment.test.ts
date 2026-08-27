import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../functions/api/admin/_shared/errors";
import { RenameDeploymentService } from "../../functions/api/admin/_shared/services/rename-deployment-service";
import type {
	ContentOperationRow,
	DraftRow,
} from "../../functions/api/admin/_shared/types";

const operation = (
	overrides: Partial<ContentOperationRow> = {},
): ContentOperationRow => ({
	id: "operation-1",
	idempotency_key: "rename-hello",
	type: "rename",
	status: "github_committed",
	draft_id: "draft-1",
	content_id: "content-1",
	user_id: "user-1",
	expected_version: 4,
	source_path: "src/content/posts/hello/index.md",
	target_path: "src/content/posts/new-name/index.md",
	expected_blob_sha: "blob-old",
	result_blob_sha: "blob-new",
	commit_sha: "commit-new",
	content_sha256: "hash",
	source_commit_sha: "commit-old",
	error_code: null,
	created_at: "2026-08-27T01:00:00.000Z",
	updated_at: "2026-08-27T01:00:00.000Z",
	completed_at: null,
	...overrides,
});

const draft = (): DraftRow => ({
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
	content: "# Hello",
	status: "published",
	created_at: "2026-08-27T00:00:00.000Z",
	updated_at: "2026-08-27T00:00:00.000Z",
	github_path: "src/content/posts/hello/index.md",
	github_sha: "blob-old",
	commit_sha: "commit-old",
	version: 4,
	sync_status: "published",
	publication_state: "published",
	workspace_state: "clean",
	deployed_path: "src/content/posts/hello/index.md",
	deployed_blob_sha: "blob-old",
	deployed_commit_sha: "commit-old",
	deployed_at: "2026-08-27T00:00:00.000Z",
	deleted_at: null,
});

class Store {
	value = operation();
	draft = draft();
	revisions = 0;
	failCompletion = false;
	async get(id: string) {
		return this.value.id === id ? this.value : null;
	}
	async listAwaitingDeployment() {
		return this.value.status === "github_committed" ? [this.value] : [];
	}
	async completeRename(id: string, commitSha: string, now: string) {
		if (this.failCompletion) {
			this.value = {
				...this.value,
				status: "reconciliation_required",
				error_code: "rename_completion_partial",
				updated_at: now,
			};
			return "partial" as const;
		}
		if (
			id !== this.value.id ||
			commitSha !== this.value.commit_sha ||
			this.value.status !== "github_committed"
		)
			return "conflict" as const;
		this.draft = {
			...this.draft,
			slug: "new-name",
			github_path: this.value.target_path,
			deployed_path: this.value.target_path,
			github_sha: this.value.result_blob_sha,
			deployed_blob_sha: this.value.result_blob_sha,
			commit_sha: commitSha,
			deployed_commit_sha: commitSha,
			version: 5,
			updated_at: now,
			deployed_at: now,
		};
		this.revisions += 1;
		this.value = {
			...this.value,
			status: "completed",
			updated_at: now,
			completed_at: now,
		};
		return "completed" as const;
	}
	async completeWithdraw(id: string, commitSha: string, now: string) {
		if (
			id !== this.value.id ||
			commitSha !== this.value.commit_sha ||
			this.value.status !== "github_committed"
		)
			return "conflict" as const;
		this.draft = {
			...this.draft,
			status: "draft",
			publication_state: "withdrawn",
			workspace_state: "clean",
			sync_status: "local",
			github_sha: null,
			deployed_blob_sha: null,
			commit_sha: null,
			deployed_commit_sha: null,
			deployed_at: null,
			version: 5,
			updated_at: now,
		};
		this.value = {
			...this.value,
			status: "completed",
			updated_at: now,
			completed_at: now,
		};
		return "completed" as const;
	}
	async completeDelete(id: string, commitSha: string, now: string) {
		if (
			id !== this.value.id ||
			commitSha !== this.value.commit_sha ||
			this.value.status !== "github_committed"
		)
			return "conflict" as const;
		this.draft = {
			...this.draft,
			publication_state: "deleted",
			deleted_at: now,
			version: 5,
			updated_at: now,
		};
		this.value = {
			...this.value,
			status: "completed",
			updated_at: now,
			completed_at: now,
		};
		return "completed" as const;
	}
	async completeRollback(
		id: string,
		commitSha: string,
		markdown: string,
		now: string,
	) {
		if (
			id !== this.value.id ||
			commitSha !== this.value.commit_sha ||
			this.value.status !== "github_committed"
		)
			return "conflict" as const;
		this.draft = {
			...this.draft,
			title: "Old",
			content: "# Old",
			github_sha: this.value.result_blob_sha,
			deployed_blob_sha: this.value.result_blob_sha,
			commit_sha: commitSha,
			deployed_commit_sha: commitSha,
			version: 5,
			updated_at: now,
			deployed_at: now,
		};
		this.revisions += markdown.includes("# Old") ? 1 : 0;
		this.value = {
			...this.value,
			status: "completed",
			updated_at: now,
			completed_at: now,
		};
		return "completed" as const;
	}
	async markDeploymentReconciliationRequired(
		id: string,
		now: string,
		code: string,
	) {
		if (id !== this.value.id || this.value.status !== "github_committed")
			return false;
		this.value = {
			...this.value,
			status: "reconciliation_required",
			error_code: code,
			updated_at: now,
			completed_at: null,
		};
		return true;
	}
	async markGitHubCommitted(
		id: string,
		now: string,
		blobSha: string | null,
		commitSha: string,
	) {
		if (
			id !== this.value.id ||
			(this.value.status !== "reconciliation_required" &&
				this.value.status !== "pending") ||
			(this.value.commit_sha !== null && this.value.commit_sha !== commitSha) ||
			(this.value.result_blob_sha !== null &&
				this.value.result_blob_sha !== blobSha)
		)
			return false;
		this.value = {
			...this.value,
			status: "github_committed",
			result_blob_sha: blobSha,
			commit_sha: commitSha,
			error_code: null,
			updated_at: now,
		};
		return true;
	}
}

const gateway = {
	async getFile(_path: string, _ref: string) {
		return {
			sha: "blob-new",
			content: "---\ntitle: Hello\npublished: 2026-08-27\n---\n\n# Hello",
		};
	},
};

const rollbackOperation = (): ContentOperationRow =>
	operation({
		type: "rollback",
		idempotency_key: "rollback-hello",
		source_path: "src/content/posts/old-hello/index.md",
		target_path: "src/content/posts/hello/index.md",
		result_blob_sha: "blob-rollback",
		commit_sha: "commit-rollback",
		source_commit_sha: "source-history",
	});

test("rename 部署成功仅按 operation commit 收敛新 slug/path/blob/commit 并记录 revision", async () => {
	const store = new Store();
	const service = new RenameDeploymentService(
		store,
		gateway,
		() => "2026-08-27T02:00:00.000Z",
	);
	const result = await service.complete({
		operationId: "operation-1",
		commitSha: "commit-new",
		outcome: "success",
	});
	assert.equal(result.status, "completed");
	assert.equal(store.draft.slug, "new-name");
	assert.equal(
		store.draft.deployed_path,
		"src/content/posts/new-name/index.md",
	);
	assert.equal(store.draft.deployed_blob_sha, "blob-new");
	assert.equal(store.draft.deployed_commit_sha, "commit-new");
	assert.equal(store.draft.version, 5);
	assert.equal(store.revisions, 1);
});

test("rename 部署失败保留旧 slug/path/blob/commit 与版本并等待恢复", async () => {
	const store = new Store();
	const before = structuredClone(store.draft);
	const result = await new RenameDeploymentService(store, gateway).complete({
		operationId: "operation-1",
		commitSha: "commit-new",
		outcome: "failure",
	});
	assert.equal(result.status, "reconciliation_required");
	assert.deepEqual(store.draft, before);
});

test("rename 部署回调必须匹配 operation commit，D1 部分失败进入待对账", async () => {
	const store = new Store();
	const service = new RenameDeploymentService(store, gateway);
	await assert.rejects(
		() =>
			service.complete({
				operationId: "operation-1",
				commitSha: "other",
				outcome: "success",
			}),
		(error: unknown) =>
			error instanceof ApiError && error.code === "deployment_commit_mismatch",
	);
	store.failCompletion = true;
	const result = await service.complete({
		operationId: "operation-1",
		commitSha: "commit-new",
		outcome: "success",
	});
	assert.equal(result.status, "reconciliation_required");
	assert.equal(store.draft.deployed_path, "src/content/posts/hello/index.md");
});

test("reconcile 仅凭 operation commit 的目标 blob 证据恢复 github_committed", async () => {
	const store = new Store();
	store.value = operation({
		status: "reconciliation_required",
		error_code: "github_commit_record_failed",
	});
	const service = new RenameDeploymentService(store, gateway);
	const result = await service.reconcile("operation-1");
	assert.equal(result.status, "github_committed");
	const mismatch = new RenameDeploymentService(store, {
		async getFile() {
			return { sha: "wrong", content: "content" };
		},
	});
	store.value = operation({ status: "reconciliation_required" });
	await assert.rejects(
		() => mismatch.reconcile("operation-1"),
		(error: unknown) =>
			error instanceof ApiError &&
			error.code === "content_operation_reconciliation_conflict",
	);
});

test("withdraw 部署成功才收敛 withdrawn clean 并提升 draft:true 部署证据", async () => {
	const store = new Store();
	store.value = operation({
		type: "withdraw",
		idempotency_key: "withdraw-hello",
		source_path: "src/content/posts/hello/index.md",
		target_path: "src/content/posts/hello/index.md",
		result_blob_sha: "blob-withdrawn",
		commit_sha: "commit-withdrawn",
	});
	const service = new RenameDeploymentService(
		store,
		{
			async getFile() {
				return null;
			},
		},
		() => "2026-08-27T02:00:00.000Z",
	);
	const result = await service.complete({
		operationId: "operation-1",
		commitSha: "commit-withdrawn",
		outcome: "success",
	});
	assert.equal(result.status, "completed");
	assert.equal(store.draft.publication_state, "withdrawn");
	assert.equal(store.draft.workspace_state, "clean");
	assert.equal(store.draft.sync_status, "local");
	assert.equal(store.draft.deployed_blob_sha, null);
	assert.equal(store.draft.deployed_commit_sha, null);
});

test("withdraw 部署失败保留 published 和原部署证据", async () => {
	const store = new Store();
	store.value = operation({
		type: "withdraw",
		idempotency_key: "withdraw-hello",
		source_path: "src/content/posts/hello/index.md",
		target_path: "src/content/posts/hello/index.md",
		result_blob_sha: "blob-withdrawn",
		commit_sha: "commit-withdrawn",
	});
	const before = structuredClone(store.draft);
	const result = await new RenameDeploymentService(store, gateway).complete({
		operationId: "operation-1",
		commitSha: "commit-withdrawn",
		outcome: "failure",
	});
	assert.equal(result.status, "reconciliation_required");
	assert.deepEqual(store.draft, before);
});
test("delete 部署成功且提交下原路径不存在时才软删并标记 publication deleted", async () => {
	const store = new Store();
	store.value = operation({
		type: "delete",
		idempotency_key: "delete-hello",
		target_path: null,
		result_blob_sha: null,
		commit_sha: "commit-deleted",
	});
	const service = new RenameDeploymentService(
		store,
		{
			async getFile() {
				return null;
			},
		},
		() => "2026-08-27T02:00:00.000Z",
	);
	const result = await service.complete({
		operationId: "operation-1",
		commitSha: "commit-deleted",
		outcome: "success",
	});
	assert.equal(result.status, "completed");
	assert.equal(store.draft.publication_state, "deleted");
	assert.equal(store.draft.deleted_at, "2026-08-27T02:00:00.000Z");
});

test("delete 部署失败或提交下路径仍存在时不软删", async () => {
	const failed = new Store();
	failed.value = operation({
		type: "delete",
		idempotency_key: "delete-hello",
		target_path: null,
		result_blob_sha: null,
		commit_sha: "commit-deleted",
	});
	const before = structuredClone(failed.draft);
	const failedResult = await new RenameDeploymentService(
		failed,
		gateway,
	).complete({
		operationId: "operation-1",
		commitSha: "commit-deleted",
		outcome: "failure",
	});
	assert.equal(failedResult.status, "reconciliation_required");
	assert.deepEqual(failed.draft, before);
	const mismatch = new Store();
	mismatch.value = operation({
		type: "delete",
		idempotency_key: "delete-hello",
		target_path: null,
		result_blob_sha: null,
		commit_sha: "commit-deleted",
	});
	await assert.rejects(
		() =>
			new RenameDeploymentService(mismatch, gateway).complete({
				operationId: "operation-1",
				commitSha: "commit-deleted",
				outcome: "success",
			}),
		(error: unknown) =>
			error instanceof ApiError && error.code === "deployment_commit_mismatch",
	);
	assert.equal(mismatch.draft.deleted_at, null);
});
test("rollback 部署成功后才更新当前 deployed 路径内容并记录 rollback revision", async () => {
	const store = new Store();
	store.value = rollbackOperation();
	const service = new RenameDeploymentService(
		store,
		{
			async getFile(filePath, ref) {
				assert.equal(filePath, "src/content/posts/hello/index.md");
				assert.equal(ref, "commit-rollback");
				return {
					sha: "blob-rollback",
					content: "---\ntitle: Old\npublished: 2026-08-27\n---\n\n# Old",
				};
			},
		},
		() => "2026-08-27T02:00:00.000Z",
	);
	const result = await service.complete({
		operationId: "operation-1",
		commitSha: "commit-rollback",
		outcome: "success",
	});
	assert.equal(result.status, "completed");
	assert.equal(store.draft.deployed_path, "src/content/posts/hello/index.md");
	assert.equal(store.draft.deployed_blob_sha, "blob-rollback");
	assert.equal(store.draft.title, "Old");
	assert.equal(store.revisions, 1);
});

test("withdraw 部署成功证据必须是目标路径不存在", async () => {
	const store = new Store();
	store.value = operation({ type: "withdraw", commit_sha: "commit-withdraw" });
	const service = new RenameDeploymentService(store, {
		async getFile() {
			return { sha: "replacement-blob", content: "# Replacement" };
		},
	});
	await assert.rejects(
		() =>
			service.complete({
				operationId: "operation-1",
				commitSha: "commit-withdraw",
				outcome: "success",
			}),
		(error: unknown) =>
			error instanceof ApiError && error.code === "deployment_commit_mismatch",
	);
	assert.equal(store.value.status, "github_committed");
	assert.equal(store.draft.publication_state, "published");
});

test("GitHub 已提交后的部署失败保留证据并进入可恢复的 reconciliation_required", async () => {
	for (const type of ["rename", "withdraw", "delete", "rollback"] as const) {
		const store = new Store();
		store.value =
			type === "rollback"
				? rollbackOperation()
				: operation({
						type,
						...(type === "withdraw" || type === "delete"
							? { result_blob_sha: null }
							: {}),
					});
		const before = structuredClone(store.draft);
		const service = new RenameDeploymentService(store, {
			async getFile() {
				return type === "withdraw" || type === "delete"
					? null
					: { sha: store.value.result_blob_sha as string, content: "# Old" };
			},
		});
		const failed = await service.complete({
			operationId: "operation-1",
			commitSha: store.value.commit_sha as string,
			outcome: "failure",
		});
		assert.equal(failed.status, "reconciliation_required");
		assert.equal(failed.commit_sha, store.value.commit_sha);
		assert.equal(failed.result_blob_sha, store.value.result_blob_sha);
		assert.deepEqual(store.draft, before);
		assert.equal(
			(await service.reconcile("operation-1")).status,
			"github_committed",
			type,
		);
	}
});

test("rollback 对账按结果 commit 的当前路径 blob 证据幂等恢复 github_committed", async () => {
	const store = new Store();
	store.value = { ...rollbackOperation(), status: "reconciliation_required" };
	const service = new RenameDeploymentService(store, {
		async getFile() {
			return { sha: "blob-rollback", content: "# Old" };
		},
	});
	assert.equal(
		(await service.reconcile("operation-1")).status,
		"github_committed",
	);
	assert.equal(
		(await service.reconcile("operation-1")).status,
		"github_committed",
	);
});

test("pending 对账仅在 operation commit 与结果 blob 证据匹配时恢复 github_committed", async () => {
	const store = new Store();
	store.value = operation({ status: "pending" });
	const result = await new RenameDeploymentService(store, gateway).reconcile(
		"operation-1",
	);
	assert.equal(result.status, "github_committed");

	store.value = operation({
		status: "pending",
		commit_sha: "commit-pending",
		result_blob_sha: "blob-expected",
	});
	await assert.rejects(
		() =>
			new RenameDeploymentService(store, {
				async getFile() {
					return { sha: "blob-other", content: "content" };
				},
			}).reconcile("operation-1"),
		(error: unknown) =>
			error instanceof ApiError &&
			error.code === "content_operation_reconciliation_conflict",
	);
});

test("withdraw 对账要求 operation commit 下目标路径不存在", async () => {
	const store = new Store();
	store.value = operation({
		type: "withdraw",
		status: "pending",
		commit_sha: "commit-withdraw",
		result_blob_sha: null,
	});
	const result = await new RenameDeploymentService(store, {
		async getFile() {
			return null;
		},
	}).reconcile("operation-1");
	assert.equal(result.status, "github_committed");
});

test("delete reconciliation 仅在 operation commit 下源路径不存在时恢复 github_committed", async () => {
	const store = new Store();
	store.value = operation({
		type: "delete",
		status: "reconciliation_required",
		idempotency_key: "delete-hello",
		target_path: null,
		result_blob_sha: null,
		commit_sha: "commit-deleted",
		error_code: "github_commit_record_failed",
	});
	const result = await new RenameDeploymentService(store, {
		async getFile() {
			return null;
		},
	}).reconcile("operation-1");
	assert.equal(result.status, "github_committed");
	store.value = operation({
		type: "delete",
		status: "reconciliation_required",
		idempotency_key: "delete-hello",
		target_path: null,
		result_blob_sha: null,
		commit_sha: "commit-deleted",
	});
	await assert.rejects(
		() => new RenameDeploymentService(store, gateway).reconcile("operation-1"),
		(error: unknown) =>
			error instanceof ApiError &&
			error.code === "content_operation_reconciliation_conflict",
	);
});
