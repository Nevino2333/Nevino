import assert from "node:assert/strict";
import test from "node:test";
import {
	defaultPostFilters,
	parsePostFilterState,
	postFilterQuery,
} from "../../src/components/admin/post-filters";

const filters = {
	query: "Astro Svelte",
	publicationState: "published" as const,
	workspaceState: "modified" as const,
	syncStatus: "modified" as const,
	tag: "Svelte",
	category: "Tech",
	page: 3,
};

test("生成完整且编码后的文章 API query", () => {
	assert.equal(
		postFilterQuery(filters, 20),
		"q=Astro+Svelte&publicationState=published&workspaceState=modified&syncStatus=modified&tag=Svelte&category=Tech&page=3&pageSize=20",
	);
});

test("客户端非法和超长筛选回退默认值", () => {
	assert.deepEqual(
		parsePostFilterState(
			new URL(
				`https://example.test/?q=${"a".repeat(201)}&publicationState=nope&workspaceState=nope&syncStatus=nope&page=0`,
			),
		),
		defaultPostFilters,
	);
});
