import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../functions/api/admin/_shared/errors";
import { DraftRepository } from "../../functions/api/admin/_shared/repositories/draft-repository";
import { DiscardRevisionService } from "../../functions/api/admin/_shared/services/discard-revision-service";
import type {
	ContentRevisionRow,
	DraftRow,
} from "../../functions/api/admin/_shared/types";

const current: DraftRow = {
	id: "draft-1",
	content_id: "content-1",
	slug: "hello-world",
	title: "Edited",
	published: "2026-08-27",
	updated: null,
	description: "",
	ai_summary: "",
	image: "",
	tags_json: "[]",
	category: "",
	lang: "zh-CN",
	pinned: 0,
	author: "",
	source_link: "",
	license_name: "",
	license_url: "",
	comment: 1,
	content: "Edited",
	status: "published",
	created_at: "2026-08-27T00:00:00.000Z",
	updated_at: "2026-08-27T02:00:00.000Z",
	github_path: "src/content/posts/hello-world/index.md",
	github_sha: "deployed-blob",
	commit_sha: "candidate-commit",
	version: 5,
	sync_status: "modified",
	publication_state: "published",
	workspace_state: "modified",
	deployed_commit_sha: "deployed-commit",
	deployed_at: "2026-08-27T01:00:00.000Z",
	deleted_at: null,
};

const deployedRevision: ContentRevisionRow = {
	id: "revision-4",
	draft_id: "draft-1",
	content_id: "content-1",
	version: 4,
	source: "publish",
	title: "Deployed",
	slug: "hello-world",
	markdown: "---\ntitle: Deployed\npublished: 2026-08-27\n---\nDeployed body",
	content_sha256: "hash",
	github_blob_sha: "deployed-blob",
	github_commit_sha: "deployed-commit",
	created_by: "user-1",
	created_at: "2026-08-27T01:00:00.000Z",
};

class Store {
	row = current;
	restored: { expectedVersion: number; revision: ContentRevisionRow } | null =
		null;
	async get() {
		return this.row;
	}
	async getDeployedRevision(_id: string) {
		return deployedRevision;
	}
	async restoreDeployedSnapshot(
		_id: string,
		expectedVersion: number,
		revision: ContentRevisionRow,
	) {
		this.restored = { expectedVersion, revision };
		return {
			...this.row,
			title: "Deployed",
			content: "Deployed body",
			version: 6,
			sync_status: "published",
			workspace_state: "clean" as const,
		};
	}
}

test("discard 使用 expectedVersion 恢复与 deployed commit 匹配的快照", async () => {
	const store = new Store();
	const result = await new DiscardRevisionService(store).discard("draft-1", 5);
	assert.equal(store.restored?.expectedVersion, 5);
	assert.equal(store.restored?.revision.github_commit_sha, "deployed-commit");
	assert.equal(result.title, "Deployed");
	assert.equal(result.version, 6);
	assert.equal(result.sync_status, "published");
	assert.equal(result.workspace_state, "clean");
});

test("discard 拒绝过期 expectedVersion", async () => {
	await assert.rejects(
		new DiscardRevisionService(new Store()).discard("draft-1", 4),
		(error: unknown) =>
			error instanceof ApiError && error.code === "content_version_conflict",
	);
});

test("discard 缺少 deployed 证据或匹配快照时拒绝", async () => {
	const store = new Store();
	store.row = { ...current, deployed_commit_sha: null };
	await assert.rejects(
		new DiscardRevisionService(store).discard("draft-1", 5),
		(error: unknown) =>
			error instanceof ApiError && error.code === "deployed_snapshot_missing",
	);
});

test("Repository discard 条件恢复部署快照并递增版本", async () => {
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
					return current;
				},
				async run() {
					return { meta: { changes: 1 } };
				},
			};
		},
	} as unknown as D1Database;
	await new DraftRepository({ DB: db } as never).restoreDeployedSnapshot(
		"draft-1",
		5,
		deployedRevision,
		{
			slug: "hello-world",
			title: "Deployed",
			published: "2026-08-27",
			tags: [],
			content: "Deployed body",
		},
		"2026-08-27T03:00:00.000Z",
	);
	assert.match(statements[0].sql, /version = version \+ 1/);
	assert.match(statements[0].sql, /deployed_commit_sha = \?/);
	assert.match(statements[0].sql, /workspace_state = 'clean'/);
	assert.match(statements[0].sql, /sync_status = 'published'/);
	assert.match(statements[0].sql, /version = \?/);
});
