import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../functions/api/admin/_shared/errors";
import { PublishTaskRepository } from "../../functions/api/admin/_shared/repositories/publish-task-repository";
import { PublishService } from "../../functions/api/admin/_shared/services/publish-service";
import type {
	ContentRevisionRow,
	DraftRow,
	PublishTaskRow,
} from "../../functions/api/admin/_shared/types";

const draft = (overrides: Partial<DraftRow> = {}): DraftRow => ({
	id: "draft-1",
	content_id: "content-1",
	slug: "hello-world",
	title: "Hello revised",
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
	content: "Revised",
	status: "published",
	created_at: "2026-08-27T00:00:00.000Z",
	updated_at: "2026-08-27T01:00:00.000Z",
	github_path: "src/content/posts/hello-world/index.md",
	github_sha: "deployed-blob",
	commit_sha: "deployed-commit",
	version: 4,
	sync_status: "modified",
	publication_state: "published",
	workspace_state: "modified",
	deployed_commit_sha: "deployed-commit",
	deployed_at: "2026-08-27T00:30:00.000Z",
	deleted_at: null,
	...overrides,
});

class Drafts {
	value = draft();
	async get() {
		return this.value;
	}
	async bindPublished() {
		return true;
	}
}

class Tasks {
	row: PublishTaskRow | null = null;
	async findByIdempotencyKey() {
		return null;
	}
	async findActiveByDraftId() {
		return null;
	}
	async get() {
		return this.row;
	}
	async create(row: PublishTaskRow) {
		this.row = row;
		return row;
	}
	async claim() {
		if (this.row) this.row.status = "publishing";
		return true;
	}
	async recordGitHubCommit(_id: string, blob: string, commit: string) {
		if (this.row)
			Object.assign(this.row, {
				status: "github_committed",
				github_blob_sha: blob,
				github_commit_sha: commit,
			});
		return true;
	}
	async markAwaitingDeploy() {
		if (this.row) this.row.status = "awaiting_deploy";
		return true;
	}
	async markReconciliationRequired() {
		return true;
	}
	async markFailed() {
		return true;
	}
}

class Revisions {
	rows: ContentRevisionRow[] = [];
	async create(row: ContentRevisionRow) {
		this.rows.push(row);
	}
}

test("已发布 clean 文章没有待发布修订时拒绝发布", async () => {
	const drafts = new Drafts();
	drafts.value = draft({ sync_status: "published", workspace_state: "clean" });
	const service = new PublishService({
		drafts,
		tasks: new Tasks(),
		revisions: new Revisions(),
		github: {
			getFile: async () => null,
			createFile: async () => ({ blobSha: "", commitSha: "" }),
			updateFile: async () => ({ blobSha: "", commitSha: "" }),
		},
	});
	await assert.rejects(
		service.publish({
			draftId: "draft-1",
			userId: "user-1",
			idempotencyKey: "publish-key",
			expectedVersion: 4,
		}),
		(error: unknown) =>
			error instanceof ApiError && error.code === "content_not_modified",
	);
});

test("发布修订使用已部署路径和 blob 证据并保存 publish 快照", async () => {
	const drafts = new Drafts();
	const tasks = new Tasks();
	const revisions = new Revisions();
	let updatedPath = "";
	let expectedBlob = "";
	const service = new PublishService({
		drafts,
		tasks,
		revisions,
		github: {
			getFile: async () => ({ sha: "deployed-blob", content: "old" }),
			createFile: async () => {
				throw new Error("unexpected_create");
			},
			updateFile: async (path, _content, sha) => {
				updatedPath = path;
				expectedBlob = sha;
				return { blobSha: "candidate-blob", commitSha: "candidate-commit" };
			},
		},
		now: () => "2026-08-27T02:00:00.000Z",
		newId: () => "task-1",
	});
	const result = await service.publish({
		draftId: "draft-1",
		userId: "user-1",
		idempotencyKey: "publish-key",
		expectedVersion: 4,
	});
	assert.equal(result.status, "awaiting_deploy");
	assert.equal(updatedPath, "src/content/posts/hello-world/index.md");
	assert.equal(expectedBlob, "deployed-blob");
	assert.equal(revisions.rows.length, 1);
	assert.equal(revisions.rows[0].source, "publish");
	assert.equal(revisions.rows[0].github_blob_sha, "deployed-blob");
	assert.equal(revisions.rows[0].github_commit_sha, "deployed-commit");
});

test("部署成功提升候选证据为 deployed 并将工作副本 clean", async () => {
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
					return null;
				},
				async run() {
					return { meta: { changes: 1 } };
				},
			};
		},
		async batch() {
			return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }];
		},
	} as unknown as D1Database;
	await new PublishTaskRepository({ DB: db } as never).completeDeployment(
		"task-1",
		"candidate-commit",
		4,
		"published",
		"2026-08-27T03:00:00.000Z",
	);
	assert.match(statements[1].sql, /deployed_commit_sha = commit_sha/);
	assert.match(statements[1].sql, /deployed_at = \?/);
	assert.match(statements[1].sql, /workspace_state = 'clean'/);
});

test("部署失败保留既有 deployed 证据并维持 modified", async () => {
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
					return null;
				},
				async run() {
					return { meta: { changes: 1 } };
				},
			};
		},
		async batch() {
			return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }];
		},
	} as unknown as D1Database;
	await new PublishTaskRepository({ DB: db } as never).completeDeployment(
		"task-1",
		"candidate-commit",
		4,
		"build_failed",
		"2026-08-27T03:00:00.000Z",
	);
	assert.doesNotMatch(statements[1].sql, /deployed_commit_sha = commit_sha/);
	assert.match(statements[1].sql, /workspace_state = 'modified'/);
	assert.match(statements[1].sql, /publication_state = 'published'/);
});
