import assert from "node:assert/strict";
import test from "node:test";
import type { PublishTaskDto } from "../../functions/api/admin/_shared/contracts";
import { ApiError } from "../../functions/api/admin/_shared/errors";
import {
	createGitHubFile,
	updateGitHubFile,
} from "../../functions/api/admin/_shared/github";
import {
	type PublishDraftRepository,
	type PublishGitHubGateway,
	PublishService,
	type PublishTaskStore,
} from "../../functions/api/admin/_shared/services/publish-service";
import type {
	DraftRow,
	PublishTaskRow,
} from "../../functions/api/admin/_shared/types";

const draft = (overrides: Partial<DraftRow> = {}): DraftRow => ({
	id: "draft-1",
	content_id: "content-1",
	slug: "hello-world",
	title: "Hello",
	published: "2026-08-27",
	updated: null,
	description: "Description",
	ai_summary: "Summary",
	image: "",
	tags_json: '["astro"]',
	category: "Tech",
	lang: "zh-CN",
	pinned: 0,
	author: "Author",
	source_link: "",
	license_name: "",
	license_url: "",
	comment: 1,
	content: "Content",
	status: "draft",
	created_at: "2026-08-27T00:00:00.000Z",
	updated_at: "2026-08-27T00:00:00.000Z",
	github_path: null,
	github_sha: null,
	commit_sha: null,
	version: 3,
	sync_status: "local",
	...overrides,
});

class MemoryDrafts implements PublishDraftRepository {
	value = draft();
	failBinding = false;
	throwBinding = false;

	async get(id: string) {
		return id === this.value.id ? this.value : null;
	}

	async bindPublished(
		id: string,
		expectedVersion: number,
		path: string,
		blobSha: string,
		commitSha: string,
		now: string,
	) {
		if (this.throwBinding) throw new Error("d1_unavailable");
		if (
			this.failBinding ||
			id !== this.value.id ||
			expectedVersion !== this.value.version
		)
			return false;
		this.value = {
			...this.value,
			status: "draft",
			sync_status: "publishing",
			github_path: path,
			github_sha: blobSha,
			commit_sha: commitSha,
			updated_at: now,
			version: this.value.version + 1,
		};
		return true;
	}
}

class MemoryTasks implements PublishTaskStore {
	rows = new Map<string, PublishTaskRow>();
	failRecordCommit = false;
	throwRecordCommit = false;
	concurrentActive: PublishTaskRow | null = null;

	async findByIdempotencyKey(key: string) {
		return (
			[...this.rows.values()].find((row) => row.idempotency_key === key) ?? null
		);
	}

	async get(id: string) {
		return this.rows.get(id) ?? null;
	}

	async findActiveByDraftId(draftId: string) {
		return (
			[...this.rows.values()].find(
				(row) =>
					row.draft_id === draftId &&
					[
						"pending",
						"publishing",
						"github_committed",
						"awaiting_deploy",
						"reconciliation_required",
					].includes(row.status),
			) ?? null
		);
	}

	async create(row: PublishTaskRow) {
		if (this.concurrentActive) {
			this.rows.set(this.concurrentActive.id, this.concurrentActive);
			this.concurrentActive = null;
			throw new Error("active_publish_slot_conflict");
		}
		this.rows.set(row.id, row);
		return row;
	}

	async claim(id: string, now: string) {
		return this.transition(id, "pending", "publishing", now, { attempts: 1 });
	}

	async recordGitHubCommit(
		id: string,
		blobSha: string,
		commitSha: string,
		now: string,
	) {
		if (this.throwRecordCommit) throw new Error("d1_unavailable");
		if (this.failRecordCommit) return false;
		return this.transition(id, "publishing", "github_committed", now, {
			github_blob_sha: blobSha,
			github_commit_sha: commitSha,
		});
	}

	async markReconciliationRequired(
		id: string,
		fromStatus: PublishTaskRow["status"],
		blobSha: string,
		commitSha: string,
		errorCode: string,
		now: string,
	) {
		return this.transition(id, fromStatus, "reconciliation_required", now, {
			github_blob_sha: blobSha,
			github_commit_sha: commitSha,
			error_code: errorCode,
			error_detail: errorCode,
		});
	}

	async markAwaitingDeploy(
		id: string,
		fromStatus: PublishTaskRow["status"],
		now: string,
	) {
		return this.transition(id, fromStatus, "awaiting_deploy", now, {
			error_code: null,
			error_detail: null,
		});
	}

	async markFailed(
		id: string,
		fromStatus: PublishTaskRow["status"],
		status: "validation_failed" | "content_conflict" | "submit_failed",
		errorCode: string,
		now: string,
	) {
		return this.transition(id, fromStatus, status, now, {
			error_code: errorCode,
			error_detail: errorCode,
			completed_at: now,
		});
	}

	private transition(
		id: string,
		fromStatus: PublishTaskRow["status"],
		status: PublishTaskRow["status"],
		now: string,
		changes: Partial<PublishTaskRow>,
	) {
		const current = this.rows.get(id);
		if (!current || current.status !== fromStatus) return false;
		this.rows.set(id, { ...current, ...changes, status, updated_at: now });
		return true;
	}
}

class MemoryGitHub implements PublishGitHubGateway {
	remote: { sha: string; content: string } | null = null;
	writes = 0;

	async getFile() {
		return this.remote;
	}

	async createFile(_path: string, content: string) {
		this.writes += 1;
		this.remote = { sha: "blob-created", content };
		return { blobSha: "blob-created", commitSha: "commit-created" };
	}

	async updateFile(_path: string, content: string, expectedSha: string) {
		this.lastExpectedSha = expectedSha;
		this.lastContent = content;
		this.writes += 1;
		this.remote = { sha: "blob-updated", content };
		return { blobSha: "blob-updated", commitSha: "commit-updated" };
	}
}

const setup = () => {
	const drafts = new MemoryDrafts();
	const tasks = new MemoryTasks();
	const github = new MemoryGitHub();
	let sequence = 0;
	const service = new PublishService({
		drafts,
		tasks,
		github,
		now: () => "2026-08-27T01:00:00.000Z",
		newId: () => `task-${++sequence}`,
	});
	return { drafts, tasks, github, service };
};

const publish = (service: PublishService): Promise<PublishTaskDto> =>
	service.publish({
		draftId: "draft-1",
		userId: "user-1",
		idempotencyKey: "publish-1",
		expectedVersion: 3,
	});

test("GitHub 创建不发送 sha，更新必须发送 expectedSha", async () => {
	const originalFetch = globalThis.fetch;
	const bodies: Record<string, unknown>[] = [];
	globalThis.fetch = async (_input, init) => {
		bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
		return new Response(
			JSON.stringify({ commit: { sha: "commit" }, content: { sha: "blob" } }),
			{ status: 200 },
		);
	};
	try {
		const config = {
			token: "token",
			owner: "owner",
			repo: "repo",
			branch: "main",
		};
		await createGitHubFile(
			config,
			"src/content/posts/hello/index.md",
			"body",
			"create",
		);
		await updateGitHubFile(
			config,
			"src/content/posts/hello/index.md",
			"body",
			"expected",
			"update",
		);
		assert.equal("sha" in bodies[0], false);
		assert.equal(bodies[1].sha, "expected");
		await assert.rejects(
			updateGitHubFile(
				config,
				"src/content/posts/hello/index.md",
				"body",
				"",
				"update",
			),
			/error|sha|expected/i,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("重复幂等键返回同一任务且只写一次 GitHub", async () => {
	const { service, github } = setup();
	const first = await publish(service);
	const second = await publish(service);
	assert.equal(second.id, first.id);
	assert.equal(github.writes, 1);
	assert.equal(second.status, "awaiting_deploy");
});

test("幂等键只能复用同一草稿、用户和版本", async () => {
	const { service, github } = setup();
	await publish(service);
	for (const input of [
		{ draftId: "draft-2", userId: "user-1", expectedVersion: 3 },
		{ draftId: "draft-1", userId: "user-2", expectedVersion: 3 },
		{ draftId: "draft-1", userId: "user-1", expectedVersion: 4 },
	]) {
		await assert.rejects(
			service.publish({ ...input, idempotencyKey: "publish-1" }),
			(error: unknown) =>
				error instanceof ApiError && error.code === "idempotency_key_conflict",
		);
	}
	assert.equal(github.writes, 1);
});

test("已有未结束发布任务时拒绝使用新幂等键重复发布", async () => {
	const { service, github } = setup();
	await publish(service);
	await assert.rejects(
		service.publish({
			draftId: "draft-1",
			userId: "user-1",
			idempotencyKey: "publish-2",
			expectedVersion: 3,
		}),
		(error: unknown) =>
			error instanceof ApiError && error.code === "publish_already_requested",
	);
	assert.equal(github.writes, 1);
});

test("并发创建命中活动发布槽时返回现有任务且不写 GitHub", async () => {
	const { service, github, tasks } = setup();
	tasks.concurrentActive = {
		id: "task-concurrent",
		idempotency_key: "publish-concurrent",
		draft_id: "draft-1",
		user_id: "user-1",
		expected_version: 3,
		target_path: "src/content/posts/hello-world/index.md",
		content_sha256: "hash",
		status: "pending",
		attempts: 0,
		github_blob_sha: null,
		github_commit_sha: null,
		error_code: null,
		error_detail: null,
		created_at: "2026-08-27T01:00:00.000Z",
		updated_at: "2026-08-27T01:00:00.000Z",
		completed_at: null,
	};
	await assert.rejects(
		publish(service),
		(error: unknown) =>
			error instanceof ApiError && error.code === "publish_already_requested",
	);
	assert.equal(github.writes, 0);
});

test("提交 GitHub 后草稿仍保持 draft，等待部署确认", async () => {
	const { service, drafts } = setup();
	const result = await publish(service);
	assert.equal(result.status, "awaiting_deploy");
	assert.equal(drafts.value.status, "draft");
	assert.equal(drafts.value.sync_status, "publishing");
});

test("未绑定草稿的目标路径已存在时不写 GitHub", async () => {
	const { service, github } = setup();
	github.remote = { sha: "occupied", content: "other" };
	await assert.rejects(publish(service), (error: unknown) => {
		assert.ok(error instanceof ApiError);
		assert.equal(error.code, "content_path_occupied");
		return true;
	});
	assert.equal(github.writes, 0);
});

test("已绑定 SHA 与远端不一致时不写 GitHub", async () => {
	const { service, github, drafts } = setup();
	drafts.value = draft({
		github_sha: "bound-sha",
		github_path: "src/content/posts/hello-world/index.md",
	});
	github.remote = { sha: "changed-sha", content: "other" };
	await assert.rejects(publish(service), (error: unknown) => {
		assert.ok(error instanceof ApiError);
		assert.equal(error.code, "content_remote_changed");
		return true;
	});
	assert.equal(github.writes, 0);
});

test("GitHub 成功后草稿绑定失败进入 reconciliation_required", async () => {
	const { service, drafts, tasks } = setup();
	drafts.failBinding = true;
	const result = await publish(service);
	assert.equal(result.status, "reconciliation_required");
	assert.equal(result.errorCode, "draft_binding_failed");
	assert.equal(tasks.rows.get(result.id)?.github_commit_sha, "commit-created");
});

test("GitHub 成功后记录 commit 抛错仍进入 reconciliation_required", async () => {
	const { service, tasks } = setup();
	tasks.throwRecordCommit = true;
	const result = await publish(service);
	assert.equal(result.status, "reconciliation_required");
	assert.equal(result.errorCode, "github_commit_record_failed");
	assert.equal(result.githubCommitSha, "commit-created");
});

test("GitHub 成功后草稿绑定抛错仍进入 reconciliation_required", async () => {
	const { service, drafts } = setup();
	drafts.throwBinding = true;
	const result = await publish(service);
	assert.equal(result.status, "reconciliation_required");
	assert.equal(result.errorCode, "draft_binding_failed");
});

test("对账校验远端内容摘要后恢复绑定并进入 awaiting_deploy", async () => {
	const { service, drafts } = setup();
	drafts.failBinding = true;
	const failed = await publish(service);
	drafts.failBinding = false;
	const reconciled = await service.reconcile(failed.id);
	assert.equal(reconciled.status, "awaiting_deploy");
	assert.equal(drafts.value.github_sha, "blob-created");
});

test("对账证据不匹配时保持 reconciliation_required", async () => {
	const { service, drafts, github } = setup();
	drafts.failBinding = true;
	const failed = await publish(service);
	drafts.failBinding = false;
	github.remote = { sha: "other-blob", content: "other" };
	await assert.rejects(service.reconcile(failed.id), (error: unknown) => {
		assert.ok(error instanceof ApiError);
		assert.equal(error.code, "reconciliation_evidence_mismatch");
		assert.equal(error.retryable, false);
		return true;
	});
	assert.equal(
		(await service.getTask(failed.id)).status,
		"reconciliation_required",
	);
});

test("withdrawn 重新发布沿用原路径与 deployed blob，并写回 draft:false", async () => {
	const { service, drafts, github } = setup();
	drafts.value = draft({
		status: "published",
		publication_state: "withdrawn",
		workspace_state: "clean",
		sync_status: "published",
		github_path: "src/content/posts/hello-world/index.md",
		github_sha: "withdrawn-blob",
		commit_sha: "withdrawn-commit",
		deployed_path: "src/content/posts/hello-world/index.md",
		deployed_blob_sha: "withdrawn-blob",
		deployed_commit_sha: "withdrawn-commit",
		deployed_at: "2026-08-27T00:30:00.000Z",
	});
	github.remote = { sha: "withdrawn-blob", content: "withdrawn" };
	const result = await publish(service);
	assert.equal(result.targetPath, "src/content/posts/hello-world/index.md");
	assert.equal(github.lastExpectedSha, "withdrawn-blob");
	assert.equal(github.lastContent?.includes("draft: false"), true);
});
