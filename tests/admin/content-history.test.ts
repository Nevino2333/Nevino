import assert from "node:assert/strict";
import test from "node:test";
import {
	ContentHistoryService,
	type HistoryCommit,
	type HistoryOperation,
	type HistoryRevision,
} from "../../functions/api/admin/_shared/services/content-history-service";

const operations: HistoryOperation[] = [
	{
		id: "operation-1",
		contentId: "content-1",
		type: "rollback",
		status: "completed",
		path: "src/content/posts/hello/index.md",
		commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		createdAt: "2026-08-27T04:00:00.000Z",
	},
];

const revisions: HistoryRevision[] = [
	{
		id: "revision-2",
		contentId: "content-1",
		source: "rollback",
		version: 5,
		path: "src/content/posts/hello/index.md",
		commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		createdAt: "2026-08-27T04:00:00.000Z",
	},
	{
		id: "revision-1",
		contentId: "content-1",
		source: "save",
		version: 4,
		path: null,
		commitSha: null,
		createdAt: "2026-08-27T03:00:00.000Z",
	},
];

const commits: HistoryCommit[] = [
	{
		sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		path: "src/content/posts/hello/index.md",
		message: "Rollback hello",
		authorName: "Admin",
		authorDate: "2026-08-27T04:00:00.000Z",
	},
	{
		sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		path: "src/content/posts/old-hello/index.md",
		message: "Previous",
		authorName: "Admin",
		authorDate: "2026-08-27T02:00:00.000Z",
	},
];

test("统一时间线按 content_id 合并 operation/revision/GitHub commit，按时间倒序并按 commit 去重", () => {
	const result = new ContentHistoryService().merge({
		contentId: "content-1",
		operations,
		revisions,
		commits,
		page: 1,
		pageSize: 10,
	});
	assert.deepEqual(
		result.items.map((item) => ({
			at: item.createdAt,
			sources: item.sources,
			commit: item.commitSha,
		})),
		[
			{
				at: "2026-08-27T04:00:00.000Z",
				sources: ["operation", "revision", "github"],
				commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			},
			{
				at: "2026-08-27T03:00:00.000Z",
				sources: ["revision"],
				commit: null,
			},
			{
				at: "2026-08-27T02:00:00.000Z",
				sources: ["github"],
				commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			},
		],
	);
	assert.equal(result.total, 3);
});

test("统一时间线在去重后稳定分页且拒绝混入其他 content_id", () => {
	const result = new ContentHistoryService().merge({
		contentId: "content-1",
		operations: [
			...operations,
			{ ...operations[0], id: "foreign", contentId: "content-2" },
		],
		revisions,
		commits,
		page: 2,
		pageSize: 1,
	});
	assert.equal(result.total, 3);
	assert.equal(result.items.length, 1);
	assert.equal(result.items[0]?.revisionId, "revision-1");
	assert.equal(result.items[0]?.id, "revision:4");
});
