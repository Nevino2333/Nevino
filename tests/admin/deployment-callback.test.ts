import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ApiError } from "../../functions/api/admin/_shared/errors";
import { verifyDeploymentCallbackSecret } from "../../functions/api/admin/_shared/handler";
import { completeAwaitingOperations } from "../../functions/api/admin/deployment-callback";
import { PublishTaskRepository } from "../../functions/api/admin/_shared/repositories/publish-task-repository";
import {
	DeploymentCallbackService,
	type DeploymentCompletionResult,
	type DeploymentTaskStore,
} from "../../functions/api/admin/_shared/services/deployment-callback-service";
import type {
	ContentOperationRow,
	PublishTaskRow,
} from "../../functions/api/admin/_shared/types";
import {
	RenameDeploymentService,
	type RenameDeploymentStore,
} from "../../functions/api/admin/_shared/services/rename-deployment-service";

const task = (overrides: Partial<PublishTaskRow> = {}): PublishTaskRow => ({
	id: "task-1",
	idempotency_key: "publish-1",
	draft_id: "draft-1",
	user_id: "user-1",
	expected_version: 3,
	target_path: "src/content/posts/hello-world/index.md",
	content_sha256: "hash",
	status: "awaiting_deploy",
	attempts: 1,
	github_blob_sha: "blob-1",
	github_commit_sha: "commit-1",
	error_code: null,
	error_detail: null,
	created_at: "2026-08-27T01:00:00.000Z",
	updated_at: "2026-08-27T01:00:00.000Z",
	completed_at: null,
	...overrides,
});

class MemoryStore implements DeploymentTaskStore {
	values = [task()];
	draftStatus: "draft" | "published" | "build_failed" = "draft";
	completionResult: DeploymentCompletionResult = "completed";

	get value() {
		return this.values[0];
	}

	set value(value: PublishTaskRow) {
		this.values[0] = value;
	}

	async get(id: string) {
		return this.values.find((value) => value.id === id) ?? null;
	}

	async listAwaitingDeployment() {
		return this.values.filter((value) => value.status === "awaiting_deploy");
	}

	async completeDeployment(
		id: string,
		commitSha: string,
		expectedVersion: number,
		status: "published" | "build_failed",
		now: string,
	) {
		const index = this.values.findIndex((value) => value.id === id);
		const value = this.values[index];
		if (
			!value ||
			expectedVersion !== value.expected_version ||
			value.status !== "awaiting_deploy" ||
			value.github_commit_sha !== commitSha
		)
			return "conflict" as const;
		if (this.completionResult === "partial") {
			this.values[index] = {
				...value,
				status: "reconciliation_required",
				error_code: "deployment_completion_partial",
				error_detail: "deployment_completion_partial",
				updated_at: now,
				completed_at: null,
			};
			return "partial" as const;
		}
		this.values[index] = {
			...value,
			status,
			error_code: status === "build_failed" ? "deployment_build_failed" : null,
			error_detail:
				status === "build_failed" ? "deployment_build_failed" : null,
			updated_at: now,
			completed_at: now,
		};
		this.draftStatus = status;
		return "completed" as const;
	}
}

test("部署回调必须使用专用 secret", () => {
	assert.throws(
		() => verifyDeploymentCallbackSecret("wrong", "dedicated-secret"),
		(error: unknown) => error instanceof ApiError && error.code === "forbidden",
	);
	assert.doesNotThrow(() =>
		verifyDeploymentCallbackSecret("dedicated-secret", "dedicated-secret"),
	);
});

test("可信部署成功回调校验 commit 后完成 published", async () => {
	const store = new MemoryStore();
	const service = new DeploymentCallbackService(
		store,
		() => "2026-08-27T02:00:00.000Z",
	);
	const result = await service.complete({
		taskId: "task-1",
		commitSha: "commit-1",
		outcome: "success",
	});
	assert.equal(result.status, "published");
	assert.equal(store.draftStatus, "published");
});

test("可信部署失败回调将任务和草稿完成为 build_failed", async () => {
	const store = new MemoryStore();
	const service = new DeploymentCallbackService(
		store,
		() => "2026-08-27T02:00:00.000Z",
	);
	const result = await service.complete({
		taskId: "task-1",
		commitSha: "commit-1",
		outcome: "failure",
	});
	assert.equal(result.status, "build_failed");
	assert.equal(result.errorCode, "deployment_build_failed");
	assert.equal(store.draftStatus, "build_failed");
});

test("重复部署回调幂等返回相同终态", async () => {
	const store = new MemoryStore();
	const service = new DeploymentCallbackService(
		store,
		() => "2026-08-27T02:00:00.000Z",
	);
	const input = {
		taskId: "task-1",
		commitSha: "commit-1",
		outcome: "success" as const,
	};
	const first = await service.complete(input);
	const second = await service.complete(input);
	assert.deepEqual(second, first);
	assert.equal(store.draftStatus, "published");
});

test("Repository 在 batch 任一 change 非 1 时补偿为 reconciliation_required", async () => {
	for (const changes of [
		[1, 0],
		[0, 1],
		[0, 0],
	] as const) {
		const statements: Array<{ sql: string; bindings: unknown[] }> = [];
		const db = {
			prepare(sql: string) {
				const statement = { sql, bindings: [] as unknown[] };
				statements.push(statement);
				return {
					bind(...bindings: unknown[]) {
						statement.bindings = bindings;
						return this;
					},
					async run() {
						return { meta: { changes: 1 } };
					},
				};
			},
			async batch() {
				return changes.map((value) => ({ meta: { changes: value } }));
			},
		} as unknown as D1Database;
		const repository = new PublishTaskRepository({ DB: db } as never);
		const result = await repository.completeDeployment(
			"task-1",
			"commit-1",
			3,
			"published",
			"2026-08-27T02:00:00.000Z",
		);
		assert.equal(result, "partial");
		assert.equal(statements.length, 3);
		assert.match(statements[1].sql, /version = \?/);
		assert.match(statements[1].sql, /commit_sha = \?/);
		assert.match(statements[1].sql, /sync_status = 'publishing'/);
		assert.deepEqual(statements[1].bindings, [
			"2026-08-27T02:00:00.000Z",
			"2026-08-27T02:00:00.000Z",
			"task-1",
			"commit-1",
			4,
			"commit-1",
		]);
		assert.match(statements[2].sql, /reconciliation_required/);
		assert.deepEqual(statements[2].bindings, [
			"deployment_completion_partial",
			"deployment_completion_partial",
			"2026-08-27T02:00:00.000Z",
			"task-1",
			3,
			"commit-1",
			"2026-08-27T02:00:00.000Z",
		]);
	}
});

test("Repository completeDeployment 补偿不覆盖并发相反合法终态并返回冲突", async () => {
	const statements: Array<{ sql: string; bindings: unknown[] }> = [];
	const db = {
		prepare(sql: string) {
			const statement = { sql, bindings: [] as unknown[] };
			statements.push(statement);
			return {
				bind(...bindings: unknown[]) {
					statement.bindings = bindings;
					return this;
				},
				async first() {
					return task({ status: "build_failed" });
				},
				async run() {
					return { meta: { changes: 0 } };
				},
			};
		},
		async batch() {
			return [{ meta: { changes: 0 } }, { meta: { changes: 0 } }];
		},
	} as unknown as D1Database;
	const result = await new PublishTaskRepository({
		DB: db,
	} as never).completeDeployment(
		"task-1",
		"commit-1",
		3,
		"published",
		"2026-08-27T02:00:00.000Z",
	);
	assert.equal(result, "conflict");
	const compensation = statements.find((statement) =>
		statement.sql.includes("reconciliation_required"),
	);
	assert.ok(compensation);
	assert.match(
		compensation.sql,
		/status IN \('awaiting_deploy', 'published'\)/,
	);
	assert.match(compensation.sql, /expected_version = \?/);
	assert.match(compensation.sql, /github_commit_sha = \?/);
});

test("Repository completeDeployment 补偿 0 changes 后重读相同目标终态并幂等完成", async () => {
	const db = {
		prepare() {
			return {
				bind() {
					return this;
				},
				async first() {
					return task({ status: "published" });
				},
				async run() {
					return { meta: { changes: 0 } };
				},
			};
		},
		async batch() {
			return [{ meta: { changes: 0 } }, { meta: { changes: 0 } }];
		},
	} as unknown as D1Database;
	const result = await new PublishTaskRepository({
		DB: db,
	} as never).completeDeployment(
		"task-1",
		"commit-1",
		3,
		"published",
		"2026-08-27T02:00:00.000Z",
	);
	assert.equal(result, "completed");
});

test("部署完成任一更新未命中时返回待对账而非终态", async () => {
	const store = new MemoryStore();
	store.completionResult = "partial";
	const service = new DeploymentCallbackService(
		store,
		() => "2026-08-27T02:00:00.000Z",
	);
	const result = await service.complete({
		taskId: "task-1",
		commitSha: "commit-1",
		outcome: "success",
	});
	assert.equal(result.status, "reconciliation_required");
	assert.equal(result.errorCode, "deployment_completion_partial");
	assert.equal(result.completedAt, null);
	assert.equal(store.draftStatus, "draft");
});

test("部分完成后的后续回调不可误报 published 或 build_failed", async () => {
	const store = new MemoryStore();
	store.completionResult = "partial";
	const service = new DeploymentCallbackService(store);
	await service.complete({
		taskId: "task-1",
		commitSha: "commit-1",
		outcome: "success",
	});
	for (const outcome of ["success", "failure"] as const) {
		await assert.rejects(
			service.complete({ taskId: "task-1", commitSha: "commit-1", outcome }),
			(error: unknown) =>
				error instanceof ApiError && error.code === "deployment_state_conflict",
		);
	}
	assert.equal(store.value.status, "reconciliation_required");
	assert.equal(store.value.error_code, "deployment_completion_partial");
});

test("Cloudflare 工作流使用单一 always 回调覆盖所有 job 结果", async () => {
	const workflow = await readFile(
		new URL("../../.github/workflows/cloudflare-pages.yml", import.meta.url),
		"utf8",
	);
	assert.equal(
		(workflow.match(/name: Report deployment result/g) ?? []).length,
		1,
	);
	assert.doesNotMatch(workflow, /name: Report build failure/);
	assert.match(workflow, /cancel-in-progress: false/);
	assert.match(workflow, /if: \$\{\{ always\(\)/);
	assert.match(workflow, /JOB_STATUS: \$\{\{ job\.status \}\}/);
	assert.match(workflow, /case "\$JOB_STATUS" in/);
	assert.match(workflow, /success\) OUTCOME="success"/);
	assert.match(workflow, /failure\|cancelled\) OUTCOME="failure"/);
	assert.match(workflow, /\*\) OUTCOME="failure"/);
});

test("部署回调拒绝不匹配的 commit 且不改变任务", async () => {
	const store = new MemoryStore();
	const service = new DeploymentCallbackService(store);
	await assert.rejects(
		service.complete({
			taskId: "task-1",
			commitSha: "other-commit",
			outcome: "success",
		}),
		(error: unknown) =>
			error instanceof ApiError && error.code === "deployment_commit_mismatch",
	);
	assert.equal(store.value.status, "awaiting_deploy");
	assert.equal(store.draftStatus, "draft");
});

test("成功回调串行完成相同 commit 和祖先 commit 的 awaiting 任务", async () => {
	const store = new MemoryStore();
	store.values = [
		task({ id: "same", github_commit_sha: "deployed" }),
		task({ id: "ancestor", github_commit_sha: "older" }),
		task({ id: "behind", github_commit_sha: "newer" }),
		task({ id: "diverged", github_commit_sha: "side" }),
	];
	let active = 0;
	let maximumActive = 0;
	const service = new DeploymentCallbackService(
		store,
		undefined,
		async (base) => {
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			await Promise.resolve();
			active -= 1;
			return base === "older"
				? "ahead"
				: base === "deployed"
					? "identical"
					: base;
		},
	);
	const results = await service.completeAwaiting({
		commitSha: "deployed",
		outcome: "success",
	});
	assert.deepEqual(
		results.completed.map((result) => result.id),
		["same", "ancestor"],
	);
	assert.deepEqual(results.failed, []);
	assert.equal(maximumActive, 1);
	assert.equal(
		store.values.find((value) => value.id === "behind")?.status,
		"awaiting_deploy",
	);
	assert.equal(
		store.values.find((value) => value.id === "diverged")?.status,
		"awaiting_deploy",
	);
});

test("失败回调只完成精确 commit 的 awaiting 任务", async () => {
	const store = new MemoryStore();
	store.values = [
		task({ id: "exact", github_commit_sha: "failed" }),
		task({ id: "ancestor", github_commit_sha: "older" }),
	];
	let comparisons = 0;
	const service = new DeploymentCallbackService(store, undefined, async () => {
		comparisons += 1;
		return "ahead";
	});
	const results = await service.completeAwaiting({
		commitSha: "failed",
		outcome: "failure",
	});
	assert.deepEqual(
		results.completed.map((result) => result.id),
		["exact"],
	);
	assert.deepEqual(results.failed, []);
	assert.equal(comparisons, 0);
	assert.equal(
		store.values.find((value) => value.id === "ancestor")?.status,
		"awaiting_deploy",
	);
});
test("批量回调单任务失败时继续处理并返回摘要", async () => {
	const store = new MemoryStore();
	store.values = [
		task({ id: "exact", github_commit_sha: "deployed" }),
		task({ id: "broken", github_commit_sha: "broken" }),
		task({ id: "ancestor", github_commit_sha: "older" }),
	];
	const service = new DeploymentCallbackService(
		store,
		undefined,
		async (base) => {
			if (base === "broken")
				throw new ApiError(502, "github_compare_failed", "比较失败");
			return base === "older" ? "ahead" : "diverged";
		},
	);
	const result = await service.completeAwaiting({
		commitSha: "deployed",
		outcome: "success",
	});
	assert.deepEqual(
		result.completed.map((item) => item.id),
		["exact", "ancestor"],
	);
	assert.deepEqual(result.failed, [
		{ taskId: "broken", code: "github_compare_failed" },
	]);
	assert.equal(
		store.values.find((value) => value.id === "exact")?.status,
		"published",
	);
	assert.equal(
		store.values.find((value) => value.id === "ancestor")?.status,
		"published",
	);
	assert.equal(
		store.values.find((value) => value.id === "broken")?.status,
		"awaiting_deploy",
	);
});

class CallbackOperationStore implements RenameDeploymentStore {
	values: ContentOperationRow[];
	constructor(values: ContentOperationRow[]) {
		this.values = values;
	}
	async get(id: string) {
		return this.values.find((value) => value.id === id) ?? null;
	}
	async listAwaitingDeployment() {
		return this.values.filter((value) => value.status === "github_committed");
	}
	async completeRename() {
		return "conflict" as const;
	}
	async completeWithdraw(id: string) {
		const index = this.values.findIndex((value) => value.id === id);
		if (index < 0) return "conflict" as const;
		this.values[index] = {
			...this.values[index],
			status: "completed",
			completed_at: "2026-08-27T02:00:00.000Z",
		};
		return "completed" as const;
	}
	async completeDelete() {
		return "conflict" as const;
	}
	async completeRollback() {
		return "conflict" as const;
	}
	async markGitHubCommitted() {
		return false;
	}
	async markDeploymentReconciliationRequired(id: string) {
		const index = this.values.findIndex((value) => value.id === id);
		if (index < 0) return false;
		this.values[index] = {
			...this.values[index],
			status: "reconciliation_required",
			error_code: "deployment_build_failed",
		};
		return true;
	}
}

const contentOperation = (
	overrides: Partial<ContentOperationRow> = {},
): ContentOperationRow => ({
	id: "operation-1",
	idempotency_key: "operation-1",
	type: "withdraw",
	status: "github_committed",
	draft_id: "draft-1",
	content_id: "content-1",
	user_id: "user-1",
	expected_version: 1,
	source_path: "src/content/posts/hello/index.md",
	target_path: "src/content/posts/hello/index.md",
	expected_blob_sha: "blob-1",
	result_blob_sha: "blob-2",
	commit_sha: "commit-1",
	content_sha256: "hash",
	source_commit_sha: "commit-0",
	error_code: null,
	created_at: "2026-08-27T01:00:00.000Z",
	updated_at: "2026-08-27T01:00:00.000Z",
	completed_at: null,
	...overrides,
});

test("无 taskId 回调把 operation store 的成功纳入 completed", async () => {
	const store = new CallbackOperationStore([
		contentOperation({ id: "operation-exact", commit_sha: "failed" }),
		contentOperation({ id: "operation-ancestor", commit_sha: "older" }),
	]);
	const result = { completed: [], failed: [] } as {
		completed: ContentOperationRow[];
		failed: Array<{ taskId: string; code: string }>;
	};
	await completeAwaitingOperations(
		store,
		new RenameDeploymentService(store, { async getFile() { return null; } }),
		{ commitSha: "failed", outcome: "failure" },
		async () => "ahead",
		result,
	);
	assert.deepEqual(result.completed.map((item) => item.id), ["operation-exact"]);
	assert.deepEqual(result.failed, []);
});

test("无 taskId 回调把 operation 失败纳入 failed 并继续其他 operation", async () => {
	const store = new CallbackOperationStore([
		contentOperation({ id: "operation-broken", commit_sha: "broken", type: "rename" }),
		contentOperation({ id: "operation-exact", commit_sha: "failed" }),
	]);
	const service = new RenameDeploymentService(store, { async getFile() { throw new ApiError(502, "github_read_failed", "读取失败"); } });
	const result = { completed: [], failed: [] } as {
		completed: ContentOperationRow[];
		failed: Array<{ taskId: string; code: string }>;
	};
	await completeAwaitingOperations(
		store,
		service,
		{ commitSha: "failed", outcome: "failure" },
		async () => "ahead",
		result,
	);
	assert.deepEqual(result.completed.map((item) => item.id), ["operation-exact"]);
	assert.deepEqual(result.failed, []);
	assert.equal(store.values.find((item) => item.id === "operation-broken")?.status, "github_committed");
});