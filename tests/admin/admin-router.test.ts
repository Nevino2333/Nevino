import assert from "node:assert/strict";
import test from "node:test";
import {
	formatAdminUrl,
	parseAdminRoute,
} from "../../src/components/admin/admin-router";

const defaultFilters = {
	query: "",
	publicationState: "all" as const,
	workspaceState: "all" as const,
	syncStatus: "all" as const,
	tag: "",
	category: "",
	page: 1,
};

const filteredRoute = {
	view: "posts" as const,
	resourceId: "draft-1",
	postFilters: {
		query: "Astro Svelte",
		publicationState: "published" as const,
		workspaceState: "modified" as const,
		syncStatus: "modified" as const,
		tag: "Svelte",
		category: "Tech",
		page: 3,
	},
};

test("解析文章深链接", () => {
	assert.deepEqual(
		parseAdminRoute("http://localhost/admin/?view=posts&id=draft-1"),
		{
			view: "posts",
			resourceId: "draft-1",
			postFilters: defaultFilters,
		},
	);
});

test("文章筛选可从 URL 恢复并再次格式化", () => {
	const url = formatAdminUrl(filteredRoute);
	assert.equal(
		url,
		"/admin/?view=posts&id=draft-1&q=Astro+Svelte&publicationState=published&workspaceState=modified&syncStatus=modified&tag=Svelte&category=Tech&page=3",
	);
	assert.deepEqual(parseAdminRoute(`https://example.com${url}`), filteredRoute);
});

test("未知视图回退仪表盘且仍携带稳定的筛选状态", () => {
	assert.deepEqual(parseAdminRoute("http://localhost/admin/?view=unknown"), {
		view: "dashboard",
		resourceId: null,
		postFilters: defaultFilters,
	});
});

test("默认筛选不污染 URL", () => {
	assert.equal(
		formatAdminUrl({
			view: "posts",
			resourceId: "a b",
			postFilters: defaultFilters,
		}),
		"/admin/?view=posts&id=a+b",
	);
});
