import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../functions/api/admin/_shared/errors";
import { PublishTaskRepository } from "../../functions/api/admin/_shared/repositories/publish-task-repository";
import {
	DeploymentRecoveryService,
	type DeploymentRecoveryStore,
} from "../../functions/api/admin/_shared/services/deployment-recovery-service";
import type { PublishTaskRow } from "../../functions/api/admin/_shared/types";

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

class MemoryStore implements DeploymentRecoveryStore {
	value = task();
	draftStatus: "draft" | "build_failed" = "draft";
	draftSyncStatus: "publishing" | "local" = "publishing";
	recoveries = 0;

	async get(id: string) {
		return id === this.value.id ? this.value : null;
	}

	async recoverAwaitingDeployment(
		id: string,
		expectedVersion: number,
		commitSha: string,
		now: string,
	) {
		if (
			id !== this.value.id ||
			expectedVersion !== this.value.expected_version ||
			commitSha !== this.value.github_commit_sha ||
			(this.value.status !== "awaiting_deploy" &&
				!(
					this.value.status === "build_failed" &&
					this.value.error_code === "deployment_wait_recovered"
				))
		)
			return "conflict" as const;
		if (this.value.status === "awaiting_deploy") {
			this.recoveries += 1;
			this.value = {
				...this.value,
				status: "build_failed",
				error_code: "deployment_wait_recovered",
				error_detail: "deployment_wait_recovered",
				updated_at: now,
				completed_at: now,
			};
			this.draftStatus = "build_failed";
			this.draftSyncStatus = "local";
		}
		return "recovered" as const;
	}
}

test("recovery 仅将 awaiting_deploy 原子恢复为可编辑 build_failed", async () => {
	const store = new MemoryStore();
	const result = await new DeploymentRecoveryService(
		store,
		() => "2026-08-27T03:00:00.000Z",
	).recover("task-1");
	assert.equal(result.status, "build_failed");
	assert.equal(result.errorCode, "deployment_wait_recovered");
	assert.equal(store.draftStatus, "build_failed");
	assert.equal(store.draftSyncStatus, "local");
	assert.equal(store.recoveries, 1);
});

test("重复 recovery 明确返回状态冲突", async () => {
	const store = new MemoryStore();
	const service = new DeploymentRecoveryService(store);
	await service.recover("task-1");
	await assert.rejects(
		service.recover("task-1"),
		(error: unknown) =>
			error instanceof ApiError &&
			error.code === "deployment_recovery_conflict",
	);
	assert.equal(store.recoveries, 1);
});

test("recovery 拒绝非 awaiting_deploy 状态", async () => {
	for (const status of [
		"pending",
		"published",
		"reconciliation_required",
	] as const) {
		const store = new MemoryStore();
		store.value = task({ status });
		await assert.rejects(
			new DeploymentRecoveryService(store).recover("task-1"),
			(error: unknown) =>
				error instanceof ApiError &&
				error.code === "deployment_recovery_conflict",
		);
	}
});

test("Repository recovery 通过单个原子 batch 更新任务与草稿并释放活动槽", async () => {
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
					return task();
				},
			};
		},
		async batch() {
			return [
				{ meta: { changes: 1 } },
				{ meta: { changes: 1 } },
				{ results: [{ valid: 1 }] },
			];
		},
	} as unknown as D1Database;
	const recovered = await new PublishTaskRepository({
		DB: db,
	} as never).recoverAwaitingDeployment(
		"task-1",
		3,
		"commit-1",
		"2026-08-27T03:00:00.000Z",
	);
	assert.equal(recovered, "recovered");
	assert.equal(statements.length, 3);
	assert.match(statements[0].sql, /status = 'build_failed'/);
	assert.match(statements[0].sql, /status = 'awaiting_deploy'/);
	assert.match(statements[1].sql, /sync_status = 'local'/);
	assert.match(statements[2].sql, /deployment_wait_recovered/);
});
test("Repository recovery 任一更新未命中时补偿为待对账", async () => {
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
				return [
					{ meta: { changes: changes[0] } },
					{ meta: { changes: changes[1] } },
				];
			},
		} as unknown as D1Database;
		const result = await new PublishTaskRepository({
			DB: db,
		} as never).recoverAwaitingDeployment(
			"task-1",
			3,
			"commit-1",
			"2026-08-27T03:00:00.000Z",
		);
		assert.equal(result, "partial");
		assert.equal(statements.length, 4);
		assert.match(statements[3].sql, /reconciliation_required/);
		assert.deepEqual(statements[3].bindings, [
			"deployment_recovery_partial",
			"deployment_recovery_partial",
			"2026-08-27T03:00:00.000Z",
			"task-1",
			3,
			"commit-1",
			"2026-08-27T03:00:00.000Z",
		]);
	}
});

test("Repository recovery 补偿不覆盖并发 published 终态并返回冲突", async () => {
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
	} as never).recoverAwaitingDeployment(
		"task-1",
		3,
		"commit-1",
		"2026-08-27T03:00:00.000Z",
	);
	assert.equal(result, "conflict");
	const compensation = statements.find((statement) =>
		statement.sql.includes("reconciliation_required"),
	);
	assert.ok(compensation);
	assert.match(
		compensation.sql,
		/status IN \('awaiting_deploy', 'build_failed'\)/,
	);
	assert.match(compensation.sql, /expected_version = \?/);
	assert.match(compensation.sql, /github_commit_sha = \?/);
});

test("Service 对 recovery 部分成功返回待对账且不误报已恢复", async () => {
	const store = new MemoryStore();
	store.recoverAwaitingDeployment = async (
		_id,
		_expectedVersion,
		_commitSha,
		now,
	) => {
		store.value = task({
			status: "reconciliation_required",
			error_code: "deployment_recovery_partial",
			error_detail: "deployment_recovery_partial",
			updated_at: now,
		});
		return "partial";
	};
	const service = new DeploymentRecoveryService(store);
	const result = await service.recover("task-1");
	assert.equal(result.status, "reconciliation_required");
	assert.equal(result.errorCode, "deployment_recovery_partial");
	await assert.rejects(
		service.recover("task-1"),
		(error: unknown) =>
			error instanceof ApiError &&
			error.code === "deployment_recovery_conflict",
	);
});
