import assert from "node:assert/strict";
import test from "node:test";
import { classifyImportCandidates } from "../../functions/api/admin/_shared/services/content-operation-service";

test("候选只接受文章目录文件并规范分类", () => {
	assert.deepEqual(
		classifyImportCandidates(
			[
				"src/content/posts/alpha/index.md",
				"src/content/posts/beta/index.md",
				"src/content/posts/legacy/index.mdx",
				"src/content/posts/Bad/index.md",
				"README.md",
			],
			new Map([["src/content/posts/beta/index.md", "draft-2"]]),
		),
		[
			{
				id: "src/content/posts/alpha/index.md",
				path: "src/content/posts/alpha/index.md",
				slug: "alpha",
				classification: "importable",
				draftId: null,
			},
			{
				id: "src/content/posts/beta/index.md",
				path: "src/content/posts/beta/index.md",
				slug: "beta",
				classification: "bound",
				draftId: "draft-2",
			},
			{
				id: "src/content/posts/legacy/index.mdx",
				path: "src/content/posts/legacy/index.mdx",
				slug: "legacy",
				classification: "unsupported",
				draftId: null,
			},
			{
				id: "src/content/posts/Bad/index.md",
				path: "src/content/posts/Bad/index.md",
				slug: null,
				classification: "invalid",
				draftId: null,
			},
		],
	);
});
