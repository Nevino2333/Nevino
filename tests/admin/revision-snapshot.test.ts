import assert from "node:assert/strict";
import test from "node:test";
import { DraftRepository } from "../../functions/api/admin/_shared/repositories/draft-repository";
import { RevisionRepository } from "../../functions/api/admin/_shared/repositories/revision-repository";
import type {
	DraftInput,
	DraftRow,
} from "../../functions/api/admin/_shared/types";

const input: DraftInput = {
	slug: "hello-world",
	title: "Hello revised",
	published: "2026-08-27",
	tags: ["astro"],
	content: "Revised content",
};

const row: DraftRow = {
	id: "draft-1",
	slug: "hello-world",
	title: "Hello revised",
	published: "2026-08-27",
	updated: null,
	description: "",
	ai_summary: "",
	image: "",
	tags_json: '["astro"]',
	category: "",
	lang: "zh-CN",
	pinned: 0,
	author: "",
	source_link: "",
	license_name: "",
	license_url: "",
	comment: 1,
	content: "Revised content",
	status: "published",
	created_at: "2026-08-27T00:00:00.000Z",
	updated_at: "2026-08-27T01:00:00.000Z",
	github_path: "src/content/posts/hello-world/index.md",
	github_sha: "deployed-blob",
	commit_sha: "candidate-commit",
	content_id: "content-1",
	version: 4,
	sync_status: "modified",
	publication_state: "published",
	workspace_state: "modified",
	deployed_commit_sha: "deployed-commit",
	deployed_at: "2026-08-27T00:30:00.000Z",
	deleted_at: null,
};

const database = (batchChanges: number[] = [1, 1]) => {
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
					return row;
				},
				async all() {
					return { results: [] };
				},
				async run() {
					return { meta: { changes: 1 } };
				},
			};
		},
		async batch() {
			return batchChanges.map((changes) => ({ meta: { changes } }));
		},
	} as unknown as D1Database;
	return { db, statements };
};

test("导入使用单个 batch 按 draft、revision、completed operation 顺序原子写入", async () => {
	const { db, statements } = database();
	const draft = { ...row, id: "draft-import", content_id: "content-import" };
	await new DraftRepository({ DB: db } as never).importPublished(draft, {
		id: "revision-import",
		userId: "user-1",
		markdown: "markdown",
		contentSha256: "content-hash",
		operation: {
			id: "operation-import",
			idempotency_key: "import-request",
			type: "import",
			status: "completed",
			draft_id: draft.id,
			content_id: draft.content_id,
			user_id: "user-1",
			expected_version: 0,
			source_path: draft.github_path,
			target_path: draft.github_path,
			expected_blob_sha: draft.github_sha,
			result_blob_sha: draft.github_sha,
			commit_sha: draft.commit_sha,
			content_sha256: "content-hash",
			source_commit_sha: draft.commit_sha,
			error_code: null,
			created_at: draft.created_at,
			updated_at: draft.updated_at,
			completed_at: draft.updated_at,
		},
	});
	assert.equal(statements.length, 3);
	assert.match(statements[0].sql, /^INSERT INTO admin_drafts/);
	assert.match(statements[1].sql, /^INSERT INTO admin_content_revisions/);
	assert.match(statements[2].sql, /^INSERT INTO admin_content_operations/);
	assert.match(statements[2].sql, /'completed'/);
});

test("保存已发布文章时草稿更新与 revision 快照使用同一个原子 batch", async () => {
	const { db, statements } = database();
	const result = await new DraftRepository({ DB: db } as never).update(
		"draft-1",
		3,
		input,
		"2026-08-27T01:00:00.000Z",
		{
			id: "revision-4",
			userId: "user-1",
			markdown: "---\ntitle: Hello revised\n---\nRevised content",
			contentSha256: "content-hash",
			syncStatus: "modified",
		},
	);
	assert.equal(result?.version, 4);
	assert.equal(statements.length, 3);
	assert.match(statements[0].sql, /workspace_state = 'modified'/);
	assert.match(statements[0].sql, /deleted_at IS NULL/);
	assert.match(statements[1].sql, /INSERT INTO admin_content_revisions/);
	assert.match(statements[1].sql, /SELECT \?, id, content_id, \?, 'save'/);
	assert.deepEqual(statements[1].bindings.slice(0, 5), [
		"revision-4",
		4,
		"Hello revised",
		"hello-world",
		"---\ntitle: Hello revised\n---\nRevised content",
	]);
});

test("保存 batch 任一语句未命中时不返回成功", async () => {
	for (const changes of [
		[1, 0],
		[0, 1],
		[0, 0],
	]) {
		const { db } = database(changes);
		const result = await new DraftRepository({ DB: db } as never).update(
			"draft-1",
			3,
			input,
			"2026-08-27T01:00:00.000Z",
			{
				id: "revision-4",
				userId: "user-1",
				markdown: "markdown",
				contentSha256: "content-hash",
				syncStatus: "modified",
			},
		);
		assert.equal(result, null);
	}
});

test("revision 仓库按版本保存不可变完整快照", async () => {
	const { db, statements } = database();
	await new RevisionRepository({ DB: db } as never).create({
		id: "revision-4",
		draft_id: "draft-1",
		content_id: "content-1",
		version: 4,
		source: "publish",
		title: "Hello revised",
		slug: "hello-world",
		markdown: "markdown",
		content_sha256: "content-hash",
		github_blob_sha: "deployed-blob",
		github_commit_sha: "deployed-commit",
		created_by: "user-1",
		created_at: "2026-08-27T01:00:00.000Z",
	});
	assert.match(
		statements[0].sql,
		/INSERT OR IGNORE INTO admin_content_revisions/,
	);
	assert.equal(statements[0].bindings[7], "markdown");
});
