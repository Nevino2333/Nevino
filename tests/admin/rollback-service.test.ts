import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../functions/api/admin/_shared/errors";
import { RollbackService } from "../../functions/api/admin/_shared/services/rollback-service";
import type {
	ContentOperationRow,
	DraftRow,
} from "../../functions/api/admin/_shared/types";

const sourceCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const headCommit = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const path = "src/content/posts/hello/index.md";
const oldMarkdown = "---\ntitle: Old\npublished: 2026-08-27\n---\n\n# Old\n";
const currentMarkdown =
	"---\ntitle: Current\npublished: 2026-08-27\n---\n\n# Current\n";

const draft = (overrides: Partial<DraftRow> = {}): DraftRow => ({
	id: "draft-1",
	content_id: "content-1",
	slug: "hello",
	title: "Current",
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
	content: "# Current\n",
	status: "published",
	created_at: "2026-08-27T00:00:00.000Z",
	updated_at: "2026-08-27T01:00:00.000Z",
	github_path: path,
	github_sha: "blob-current",
	commit_sha: headCommit,
	version: 4,
	sync_status: "published",
	publication_state: "published",
	workspace_state: "clean",
	deployed_path: path,
	deployed_blob_sha: "blob-current",
	deployed_commit_sha: headCommit,
	deployed_at: "2026-08-27T01:00:00.000Z",
	deleted_at: null,
	...overrides,
});

class Store {
	draft = draft();
	operation: ContentOperationRow | null = null;
	async getDraft() {
		return this.draft;
	}
	async findByIdempotencyKey(key: string) {
		return this.operation?.idempotency_key === key ? this.operation : null;
	}
	async createPending(row: ContentOperationRow) {
		this.operation = row;
		return row;
	}
	async markGitHubCommitted(
		id: string,
		now: string,
		blob: string | null,
		commit: string,
	) {
		if (!this.operation || this.operation.id !== id) return false;
		this.operation = {
			...this.operation,
			status: "github_committed",
			result_blob_sha: blob,
			commit_sha: commit,
			updated_at: now,
		};
		return true;
	}
	async markReconciliationRequired(
		id: string,
		now: string,
		blob: string | null,
		commit: string,
		code: string,
	) {
		if (!this.operation || this.operation.id !== id) return false;
		this.operation = {
			...this.operation,
			status: "reconciliation_required",
			result_blob_sha: blob,
			commit_sha: commit,
			error_code: code,
			updated_at: now,
		};
		return true;
	}
}

class Gateway {
	writes = 0;
	async getHead() {
		return headCommit;
	}
	async getFile(filePath: string, ref: string) {
		if (filePath !== path) return null;
		return ref === sourceCommit
			? { sha: "blob-old", content: oldMarkdown }
			: { sha: "blob-current", content: currentMarkdown };
	}
	async updateFile(input: {
		path: string;
		content: string;
		expectedBlobSha: string;
		expectedHeadCommitSha: string;
	}) {
		this.writes += 1;
		assert.deepEqual(input, {
			path,
			content: oldMarkdown,
			expectedBlobSha: "blob-current",
			expectedHeadCommitSha: headCommit,
		});
		return {
			blobSha: "blob-rollback",
			commitSha: "cccccccccccccccccccccccccccccccccccccccc",
		};
	}
}

const setup = () => {
	const store = new Store();
	const gateway = new Gateway();
	let sequence = 0;
	const service = new RollbackService({
		store,
		gateway,
		history: {
			async getTrustedCommit(contentId, commit) {
				return contentId === "content-1" && commit === sourceCommit
					? { path, commitSha: sourceCommit }
					: null;
			},
		},
		now: () => "2026-08-27T02:00:00.000Z",
		newId: () => `id-${++sequence}`,
	});
	return { store, gateway, service };
};

const rollback = (
	service: RollbackService,
	overrides: Record<string, unknown> = {},
) =>
	service.rollback({
		draftId: "draft-1",
		sourceCommitSha: sourceCommit,
		expectedVersion: 4,
		expectedBlobSha: "blob-current",
		idempotencyKey: "rollback-hello",
		userId: "user-1",
		...overrides,
	});

test("rollback 校验可信历史、expected version/blob/head 后将历史内容写到当前 deployed path 并等待部署", async () => {
	const current = setup();
	const result = await rollback(current.service);
	assert.equal(result.type, "rollback");
	assert.equal(result.status, "github_committed");
	assert.equal(result.source_path, path);
	assert.equal(result.target_path, path);
	assert.equal(result.source_commit_sha, sourceCommit);
	assert.equal(current.gateway.writes, 1);
	assert.equal(current.store.draft.version, 4);
	assert.equal(current.store.draft.deployed_commit_sha, headCommit);
});

test("rollback 拒绝非可信历史、脏状态及 expected version/blob 冲突且不写 GitHub", async () => {
	for (const [overrides, code] of [
		[
			{ sourceCommitSha: "dddddddddddddddddddddddddddddddddddddddd" },
			"rollback_source_untrusted",
		],
		[{ expectedVersion: 3 }, "content_version_conflict"],
		[{ expectedBlobSha: "wrong" }, "content_blob_conflict"],
	] as const) {
		const current = setup();
		await assert.rejects(
			rollback(current.service, overrides),
			(error: unknown) => error instanceof ApiError && error.code === code,
		);
		assert.equal(current.gateway.writes, 0);
	}
	const dirty = setup();
	dirty.store.draft = draft({ workspace_state: "modified" });
	await assert.rejects(
		rollback(dirty.service),
		(error: unknown) =>
			error instanceof ApiError && error.code === "rollback_state_conflict",
	);
});

test("rollback 幂等重放不重复 commit，复用键到不同前置条件则冲突", async () => {
	const current = setup();
	const first = await rollback(current.service);
	assert.deepEqual(await rollback(current.service), first);
	assert.equal(current.gateway.writes, 1);
	await assert.rejects(
		rollback(current.service, { expectedVersion: 5 }),
		(error: unknown) =>
			error instanceof ApiError && error.code === "idempotency_key_conflict",
	);
});
