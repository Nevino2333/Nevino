import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../functions/api/admin/_shared/errors";
import { HistoryDetailService } from "../../functions/api/admin/_shared/services/history-detail-service";
import { createLineDiff } from "../../functions/api/admin/_shared/services/line-diff";

const sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const path = "src/content/posts/hello/index.md";
const markdown = "---\ntitle: Hello\npublished: 2026-08-27\n---\n\n# Old\n";
const current = "---\ntitle: Hello\npublished: 2026-08-27\n---\n\n# Current\n";

test("历史详情只使用服务端可信记录中的 path+commit 读取并严格解析", async () => {
	const reads: Array<{ path: string; commit: string }> = [];
	const service = new HistoryDetailService({
		records: {
			async getTrustedRecord(contentId, recordId) {
				return contentId === "content-1" && recordId === "commit:trusted"
					? { id: recordId, contentId, path, commitSha: sha }
					: null;
			},
		},
		github: {
			async getFile(recordPath, commit) {
				reads.push({ path: recordPath, commit });
				return { sha: "blob-old", content: markdown };
			},
		},
	});
	const result = await service.get({
		contentId: "content-1",
		recordId: "commit:trusted",
		currentMarkdown: current,
	});
	assert.deepEqual(reads, [{ path, commit: sha }]);
	assert.equal(result.record.path, path);
	assert.equal(result.parsed?.title, "Hello");
	assert.equal(result.editable, true);
	assert.equal(
		result.diff.some((line) => line.type === "remove" && line.text === "# Old"),
		true,
	);
});

test("历史详情拒绝非可信记录且解析失败时不可编辑但保留原文和 diff", async () => {
	const records = {
		async getTrustedRecord(_contentId: string, recordId: string) {
			return recordId === "commit:invalid"
				? { id: recordId, contentId: "content-1", path, commitSha: sha }
				: null;
		},
	};
	const service = new HistoryDetailService({
		records,
		github: {
			async getFile() {
				return { sha: "blob", content: "invalid" };
			},
		},
	});
	await assert.rejects(
		service.get({
			contentId: "content-1",
			recordId: "commit:forged",
			currentMarkdown: current,
		}),
		(error: unknown) =>
			error instanceof ApiError && error.code === "history_record_not_found",
	);
	const result = await service.get({
		contentId: "content-1",
		recordId: "commit:invalid",
		currentMarkdown: current,
	});
	assert.equal(result.markdown, "invalid");
	assert.equal(result.parsed, null);
	assert.equal(result.editable, false);
	assert.ok(result.diff.length > 0);
});

test("本地 revision 详情直接读取版本快照且不请求 GitHub", async () => {
	let githubReads = 0;
	const service = new HistoryDetailService({
		records: {
			async getTrustedRecord() {
				return {
					id: "revision:4",
					contentId: "content-1",
					path,
					commitSha: null,
					blobSha: null,
					markdown,
				};
			},
		},
		github: {
			async getFile() {
				githubReads += 1;
				return null;
			},
		},
	});
	const result = await service.get({
		contentId: "content-1",
		recordId: "revision:4",
		currentMarkdown: current,
	});
	assert.equal(result.markdown, markdown);
	assert.equal(result.record.id, "revision:4");
	assert.equal(githubReads, 0);
});

test("受限 line diff 拒绝过大输入并限制输出行数", () => {
	assert.throws(
		() => createLineDiff("a".repeat(262_145), "b"),
		(error: unknown) =>
			error instanceof ApiError && error.code === "diff_input_too_large",
	);
	const diff = createLineDiff(
		Array.from({ length: 800 }, (_, index) => `old-${index}`).join("\n"),
		Array.from({ length: 800 }, (_, index) => `new-${index}`).join("\n"),
	);
	assert.ok(diff.length <= 1000);
});
