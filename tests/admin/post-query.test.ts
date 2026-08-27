import assert from "node:assert/strict";
import test from "node:test";
import { DraftRepository } from "../../functions/api/admin/_shared/repositories/draft-repository";
import { toSummary } from "../../functions/api/admin/_shared/services/content-service";
import {
	buildPostQuery,
	parsePostFilters,
} from "../../functions/api/admin/_shared/services/post-query";

test("解析并规范化全部文章查询参数", () => {
	assert.deepEqual(
		parsePostFilters(
			new URL(
				"https://example.test/?q=%20Astro%20&publicationState=published&workspaceState=modified&syncStatus=reconciliation_required&tag=Svelte&category=Tech&page=2&pageSize=25",
			),
		),
		{
			query: "Astro",
			publicationState: "published",
			workspaceState: "modified",
			syncStatus: "reconciliation_required",
			tag: "Svelte",
			category: "Tech",
			page: 2,
			pageSize: 25,
		},
	);
});

test("缺省参数使用未筛选的第一页", () => {
	assert.deepEqual(parsePostFilters(new URL("https://example.test/")), {
		query: "",
		publicationState: "all",
		workspaceState: "all",
		syncStatus: "all",
		tag: "",
		category: "",
		page: 1,
		pageSize: 20,
	});
});

test("拒绝未知白名单值、超长文本和非法分页", () => {
	for (const query of [
		"publicationState=unknown",
		"workspaceState=editing",
		"syncStatus=unknown",
		`q=${"a".repeat(201)}`,
		`tag=${"a".repeat(101)}`,
		`category=${"a".repeat(101)}`,
		"page=0",
		"page=1.5",
		"pageSize=101",
	]) {
		assert.throws(
			() => parsePostFilters(new URL(`https://example.test/?${query}`)),
			(error: unknown) =>
				error instanceof Error &&
				"code" in error &&
				error.code === "validation_failed",
		);
	}
});

test("构造参数化 SQL 并始终隐藏已删除文章", () => {
	const filters = parsePostFilters(
		new URL(
			"https://example.test/?q=x%25_%5C%27%20OR%201%3D1&publicationState=published&workspaceState=modified&syncStatus=modified&tag=Astro&category=Tech",
		),
	);
	const result = buildPostQuery(filters);
	assert.match(result.whereSql, /^WHERE deleted_at IS NULL/);
	assert.match(result.whereSql, /title LIKE \? ESCAPE/);
	assert.match(result.whereSql, /slug LIKE \? ESCAPE/);
	assert.match(result.whereSql, /publication_state = \?/);
	assert.match(result.whereSql, /workspace_state = \?/);
	assert.match(result.whereSql, /sync_status = \?/);
	assert.match(result.whereSql, /json_each\(admin_drafts\.tags_json\)/);
	assert.match(result.whereSql, /category = \?/);
	assert.doesNotMatch(result.whereSql, /OR 1=1/);
	assert.deepEqual(result.params, [
		"%x\\%\\_\\\\' OR 1=1%",
		"%x\\%\\_\\\\' OR 1=1%",
		"published",
		"modified",
		"modified",
		"Astro",
		"Tech",
	]);
});

test("未筛选查询只有删除条件且无参数", () => {
	assert.deepEqual(
		buildPostQuery(parsePostFilters(new URL("https://example.test/"))),
		{ whereSql: "WHERE deleted_at IS NULL", params: [] },
	);
});

test("Repository 的列表和 COUNT 复用完全相同的筛选参数", async () => {
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
				async all() {
					return { results: [] };
				},
				async first() {
					return { total: 0 };
				},
			};
		},
	} as unknown as D1Database;
	const repository = new DraftRepository({ DB: db } as never);
	const filters = parsePostFilters(
		new URL(
			"https://example.test/?q=Astro&publicationState=published&workspaceState=modified&syncStatus=modified&tag=Svelte&category=Tech&page=3&pageSize=25",
		),
	);
	await repository.list(filters);
	await repository.count(filters);
	assert.equal(statements.length, 2);
	const listWhere = statements[0].sql.slice(
		statements[0].sql.indexOf("WHERE"),
		statements[0].sql.indexOf(" ORDER BY"),
	);
	const countWhere = statements[1].sql.slice(
		statements[1].sql.indexOf("WHERE"),
	);
	assert.equal(listWhere, countWhere);
	assert.deepEqual(statements[0].bindings.slice(0, -2), statements[1].bindings);
	assert.deepEqual(statements[0].bindings.slice(-2), [25, 50]);
	assert.doesNotMatch(statements[0].sql, /\bcontent\b/);
});

test("列表摘要包含筛选展示字段和服务端 capabilities，但不含正文", () => {
	const summary = toSummary({
		id: "draft-1",
		content_id: "content-1",
		slug: "hello",
		title: "Hello",
		published: "2026-08-27",
		tags_json: '["Astro","Svelte"]',
		category: "Tech",
		status: "published",
		sync_status: "modified",
		version: 3,
		updated_at: "2026-08-27T00:00:00.000Z",
		publication_state: "published",
		workspace_state: "modified",
		deployed_commit_sha: "commit-1",
		deployed_at: "2026-08-27T00:00:00.000Z",
	} as never);
	assert.equal(summary.published, "2026-08-27");
	assert.deepEqual(summary.tags, ["Astro", "Svelte"]);
	assert.equal(summary.category, "Tech");
	assert.equal(summary.publicationState, "published");
	assert.equal(summary.workspaceState, "editing");
	assert.equal(summary.syncStatus, "modified");
	assert.equal(summary.capabilities.editable, true);
	assert.equal("content" in summary, false);
});
