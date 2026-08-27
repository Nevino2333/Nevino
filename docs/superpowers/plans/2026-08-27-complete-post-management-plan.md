# Complete Post Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在阶段一安全发布基础上完成文章导入、修订、重命名、撤回、删除、GitHub 历史回滚和可恢复筛选 UI，使草稿、修订稿与已发布文章可以在 `/admin/` 中统一管理。

**Architecture:** D1 继续保存文章工作副本，并新增不可变修订快照和内容操作证据；GitHub 仍是线上文章事实源。所有改变线上文件的操作都经 `ContentOperationService` 编排、GitHub Gateway 执行并写入可对账证据；Markdown 解析器是导入、历史查看和回滚共用的单一边界。前端只消费 camelCase DTO，列表筛选保存在 URL，危险操作使用显式确认和版本/SHA 并发保护。

**Tech Stack:** Astro 7、Svelte 5、TypeScript、Cloudflare Pages Functions、D1、GitHub REST API、`yaml`、Web Crypto、Node.js 内置测试运行器、tsx、Biome、pnpm。

---

## 已确认基线与约束

- 批准设计：`docs/superpowers/specs/2026-08-27-complete-blog-admin-design.md`，阶段二要求导入、统一列表、筛选、修订、重命名、撤回、删除、历史与回滚。
- 阶段一已提供统一 Handler、API 错误契约、`DraftRepository`、`PublishService`、发布任务证据、版本冲突保护、GitHub create/update 安全决策、后台查询参数路由和未保存离开保护。
- 当前 `admin_drafts.status` 实际包含 `draft | published | build_failed`，`sync_status` 包含 `local | publishing | published | reconciliation_required`；阶段二扩展时必须同步 Row、DTO、数据库 CHECK/查询和 UI 标签。
- 当前 `toMarkdown()` 只有序列化能力，没有可信反解析；仓库没有直接依赖 YAML 解析器。必须显式安装 `yaml`，不得用正则解析 frontmatter。
- 当前 GitHub 封装只支持单文件读取、创建和更新。重命名必须使用 Git Data API 的单提交 tree，不允许用“先创建新文件、再删除旧文件”的两个提交模拟原子迁移。
- 当前仓库工作树没有 `src/content/posts` 文章文件；导入候选必须来自配置分支 Git tree，不能依赖构建时本地目录。
- MDX、`password`、`passwordHint`、任意 import/export、HTML/脚本继续拒绝导入和在线编辑。
- 不引入通用 GitHub 文件编辑能力；所有路径必须通过 `isAllowedGitHubPath()`，所有提交消息由服务端生成。

## 状态模型

### 内容状态

```ts
export type ContentStatus = "draft" | "published" | "withdrawn" | "build_failed";
export type ContentSyncStatus =
	| "local"
	| "modified"
	| "publishing"
	| "published"
	| "reconciliation_required";
```

- `draft/local`：只存在 D1，可编辑、可删除、可首次发布。
- `published/published`：D1 工作副本与 `github_sha` 指向的线上 blob 一致。
- `published/modified`：已发布文章存在未上线修订；线上仍由 `github_path + github_sha + commit_sha` 标识。
- `withdrawn/local`：线上文件已删除，D1 和修订历史保留，可继续编辑并重新发布。
- `build_failed/local`：保留阶段一语义，可继续编辑或重新发布。
- 任意 `*/publishing`：有正在执行的线上写操作，禁止并发编辑和危险操作。
- 任意 `*/reconciliation_required`：GitHub 已发生变化但 D1 尚未可靠收敛，只允许查看与对账。

### 操作状态与证据

```ts
export type ContentOperationType = "import" | "rename" | "withdraw" | "rollback";
export type ContentOperationStatus =
	| "pending"
	| "github_committed"
	| "completed"
	| "reconciliation_required"
	| "failed";
```

每次操作记录 `expected_version`、源/目标路径、预期 blob SHA、结果 blob SHA、commit SHA 和内容摘要。导入不写 GitHub，但仍记录远端 blob/commit 证据；重命名、撤回、回滚在 GitHub 成功而 D1 更新失败时必须进入 `reconciliation_required`，不得显示为普通失败。

## 文件结构

### 新建

- `migrations/0010_admin_complete_post_management.sql`：内容状态扩展、软删除、修订快照和操作证据。
- `functions/api/admin/_shared/repositories/revision-repository.ts`：不可变修订快照读写。
- `functions/api/admin/_shared/repositories/content-operation-repository.ts`：内容操作幂等、条件状态更新和对账读取。
- `functions/api/admin/_shared/markdown-policy.ts`：Markdown 内容长度、禁止语法和安全策略，避免解析器与草稿校验循环依赖。
- `functions/api/admin/_shared/services/content-state.ts`：根据状态和证据计算可执行动作。
- `functions/api/admin/_shared/services/content-operation-service.ts`：导入、重命名、撤回和回滚编排。
- `functions/api/admin/_shared/services/post-query.ts`：筛选参数解析与参数化 SQL 生成。
- `functions/api/admin/_shared/services/line-diff.ts`：历史版本安全文本差异。
- `functions/api/admin/imports/posts.ts`：GitHub 文章候选列表和单篇导入。
- `functions/api/admin/drafts/[id]/rename.ts`：已发布文章路径迁移。
- `functions/api/admin/drafts/[id]/withdraw.ts`：线上撤回。
- `functions/api/admin/drafts/[id]/revisions.ts`：D1 修订历史。
- `functions/api/admin/drafts/[id]/history.ts`：GitHub 提交历史。
- `functions/api/admin/drafts/[id]/history/[sha].ts`：历史内容和差异。
- `functions/api/admin/drafts/[id]/rollback.ts`：回滚到指定 GitHub 版本。
- `functions/api/admin/content-operations/[id]/reconcile.ts`：内容操作对账。
- `src/components/admin/post-filters.ts`：筛选 URL/请求参数纯函数。
- `src/components/admin/PostImportDialog.svelte`：GitHub 文章导入界面。
- `src/components/admin/PostHistoryPanel.svelte`：历史、差异与回滚界面。
- `src/components/admin/PostDangerActions.svelte`：重命名、撤回和删除确认界面。
- `tests/admin/content-state.test.ts`
- `tests/admin/markdown-parser.test.ts`
- `tests/admin/github-gateway.test.ts`
- `tests/admin/post-query.test.ts`
- `tests/admin/content-operation-service.test.ts`
- `tests/admin/line-diff.test.ts`
- `tests/admin/post-filters.test.ts`

### 修改

- `package.json`、`pnpm-lock.yaml`：加入直接依赖 `yaml`。
- `functions/api/admin/_shared/types.ts`：状态、修订 Row、操作 Row 和 GitHub DTO。
- `functions/api/admin/_shared/contracts.ts`：文章筛选、导入、修订、操作、历史和差异 DTO。
- `functions/api/admin/_shared/markdown.ts`：安全双向 Markdown 转换。
- `functions/api/admin/_shared/github.ts`：Git tree、历史、按 ref 读取、原子重命名和删除 gateway。
- `functions/api/admin/_shared/repositories/draft-repository.ts`：筛选、导入绑定、修订保存、软删除和操作收敛。
- `functions/api/admin/_shared/services/content-service.ts`：状态 DTO、编辑能力和修订快照映射。
- `functions/api/admin/_shared/services/publish-service.ts`：允许已发布修订和撤回文章发布，并保存发布前快照。
- `functions/api/admin/drafts/index.ts`：服务端筛选和统一列表。
- `functions/api/admin/drafts/[id].ts`：修订保存、软删除和危险操作约束。
- `functions/api/admin/drafts/[id]/publish.ts`：注入 RevisionRepository。
- `src/components/admin/admin-types.ts`：与后端 DTO 对齐。
- `src/components/admin/admin-router.ts`：保留文章筛选参数。
- `src/components/admin/AdminApp.svelte`：筛选加载、导入刷新和操作状态装配。
- `src/components/admin/PostListView.svelte`：搜索、状态、标签和分类筛选。
- `src/components/admin/PostEditorView.svelte`：修订状态、历史和危险操作入口。
- `src/styles/admin.css`：筛选、对话框、历史、差异和危险操作响应式样式。
- `tests/admin/content-service.test.ts`
- `tests/admin/publish-service.test.ts`
- `tests/admin/admin-router.test.ts`

---

### Task 1: 建立状态证据、修订与操作账本

**Files:**
- Create: `migrations/0010_admin_complete_post_management.sql`
- Modify: `functions/api/admin/_shared/types.ts`
- Create: `functions/api/admin/_shared/services/content-state.ts`
- Create: `tests/admin/content-state.test.ts`

- [ ] **Step 1: 写状态能力失败测试**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { contentCapabilities } from "../../functions/api/admin/_shared/services/content-state";

test("已发布且同步的文章可以修订、重命名和撤回", () => {
	assert.deepEqual(contentCapabilities("published", "published"), {
		editable: true,
		publishable: false,
		renameable: true,
		withdrawable: true,
		deletable: false,
		reconcilable: false,
	});
});

test("已发布修订只允许继续编辑和发布", () => {
	assert.deepEqual(contentCapabilities("published", "modified"), {
		editable: true,
		publishable: true,
		renameable: false,
		withdrawable: false,
		deletable: false,
		reconcilable: false,
	});
});

test("撤回文章可重新发布或删除", () => {
	assert.deepEqual(contentCapabilities("withdrawn", "local"), {
		editable: true,
		publishable: true,
		renameable: false,
		withdrawable: false,
		deletable: true,
		reconcilable: false,
	});
});

test("待对账状态只允许对账", () => {
	assert.deepEqual(contentCapabilities("published", "reconciliation_required"), {
		editable: false,
		publishable: false,
		renameable: false,
		withdrawable: false,
		deletable: false,
		reconcilable: true,
	});
});
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `pnpm exec tsx --test tests/admin/content-state.test.ts`

Expected: FAIL，错误包含 `Cannot find module` 和 `content-state`。

- [ ] **Step 3: 创建迁移**

```sql
ALTER TABLE admin_drafts ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_admin_drafts_visible_updated
ON admin_drafts(deleted_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS admin_content_revisions (
	id TEXT PRIMARY KEY,
	draft_id TEXT NOT NULL,
	content_id TEXT NOT NULL,
	version INTEGER NOT NULL,
	source TEXT NOT NULL CHECK(source IN ('save', 'import', 'publish', 'rollback')),
	title TEXT NOT NULL,
	slug TEXT NOT NULL,
	markdown TEXT NOT NULL,
	content_sha256 TEXT NOT NULL,
	github_blob_sha TEXT,
	github_commit_sha TEXT,
	created_by TEXT NOT NULL,
	created_at TEXT NOT NULL,
	FOREIGN KEY(draft_id) REFERENCES admin_drafts(id),
	FOREIGN KEY(created_by) REFERENCES admin_users(id),
	UNIQUE(draft_id, version)
);

CREATE INDEX IF NOT EXISTS idx_admin_content_revisions_draft_version
ON admin_content_revisions(draft_id, version DESC);

CREATE TABLE IF NOT EXISTS admin_content_operations (
	id TEXT PRIMARY KEY,
	idempotency_key TEXT NOT NULL UNIQUE,
	type TEXT NOT NULL CHECK(type IN ('import', 'rename', 'withdraw', 'rollback')),
	status TEXT NOT NULL CHECK(status IN ('pending', 'github_committed', 'completed', 'reconciliation_required', 'failed')),
	draft_id TEXT,
	content_id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	expected_version INTEGER NOT NULL,
	source_path TEXT,
	target_path TEXT,
	expected_blob_sha TEXT,
	result_blob_sha TEXT,
	commit_sha TEXT,
	content_sha256 TEXT NOT NULL,
	source_commit_sha TEXT,
	error_code TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	completed_at TEXT,
	FOREIGN KEY(draft_id) REFERENCES admin_drafts(id),
	FOREIGN KEY(user_id) REFERENCES admin_users(id)
);

CREATE INDEX IF NOT EXISTS idx_admin_content_operations_draft_created
ON admin_content_operations(draft_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_content_operations_active_draft
ON admin_content_operations(draft_id)
WHERE status IN ('pending', 'github_committed', 'reconciliation_required');
```

迁移不重建 `admin_drafts`，因为 SQLite 无法安全地原位扩展既有 `status` 文本约束，而初始表没有 CHECK。应用层和测试负责限制新状态值。

- [ ] **Step 4: 定义精确 Row 和状态类型**

在 `types.ts` 中将状态替换为本计划“状态模型”中的联合类型，给 `DraftRow` 增加 `deleted_at: string | null`，并加入：

```ts
export interface ContentRevisionRow {
	id: string;
	draft_id: string;
	content_id: string;
	version: number;
	source: "save" | "import" | "publish" | "rollback";
	title: string;
	slug: string;
	markdown: string;
	content_sha256: string;
	github_blob_sha: string | null;
	github_commit_sha: string | null;
	created_by: string;
	created_at: string;
}

export interface ContentOperationRow {
	id: string;
	idempotency_key: string;
	type: "import" | "rename" | "withdraw" | "rollback";
	status: "pending" | "github_committed" | "completed" | "reconciliation_required" | "failed";
	draft_id: string | null;
	content_id: string;
	user_id: string;
	expected_version: number;
	source_path: string | null;
	target_path: string | null;
	expected_blob_sha: string | null;
	result_blob_sha: string | null;
	commit_sha: string | null;
	content_sha256: string;
	source_commit_sha: string | null;
	error_code: string | null;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
}
```

- [ ] **Step 5: 实现能力纯函数**

```ts
import type { ContentStatus, ContentSyncStatus } from "../types";

export type ContentCapabilities = {
	editable: boolean;
	publishable: boolean;
	renameable: boolean;
	withdrawable: boolean;
	deletable: boolean;
	reconcilable: boolean;
};

export const contentCapabilities = (
	status: ContentStatus,
	syncStatus: ContentSyncStatus,
): ContentCapabilities => {
	if (syncStatus === "reconciliation_required")
		return { editable: false, publishable: false, renameable: false, withdrawable: false, deletable: false, reconcilable: true };
	if (syncStatus === "publishing")
		return { editable: false, publishable: false, renameable: false, withdrawable: false, deletable: false, reconcilable: false };
	if (status === "published" && syncStatus === "published")
		return { editable: true, publishable: false, renameable: true, withdrawable: true, deletable: false, reconcilable: false };
	if (status === "published" && syncStatus === "modified")
		return { editable: true, publishable: true, renameable: false, withdrawable: false, deletable: false, reconcilable: false };
	return { editable: true, publishable: true, renameable: false, withdrawable: false, deletable: true, reconcilable: false };
};
```

- [ ] **Step 6: 验证测试和本地迁移**

Run: `pnpm exec tsx --test tests/admin/content-state.test.ts && pnpm admin:db:local`

Expected: 4 tests PASS；Wrangler 报告 `0010_admin_complete_post_management.sql` 已应用且无 SQL 错误。

- [ ] **Step 7: 提交**

```bash
git add migrations/0010_admin_complete_post_management.sql functions/api/admin/_shared/types.ts functions/api/admin/_shared/services/content-state.ts tests/admin/content-state.test.ts
git commit -m "feat: add content operation evidence model"
```

---

### Task 2: 建立可信 Markdown 双向解析

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `functions/api/admin/_shared/markdown-policy.ts`
- Modify: `functions/api/admin/_shared/markdown.ts`
- Modify: `functions/api/admin/_shared/validation.ts`
- Create: `tests/admin/markdown-parser.test.ts`

- [ ] **Step 1: 安装直接依赖**

Run: `pnpm add yaml`

Expected: `package.json` 的 `dependencies` 出现 `yaml`，锁文件更新，命令退出码为 0。

- [ ] **Step 2: 写解析失败测试**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { parsePostMarkdown, toMarkdown } from "../../functions/api/admin/_shared/markdown";

const markdown = `---
title: "Hello: Firefly"
published: 2026-08-27
draft: false
description: "line one"
aiSummary: "summary"
image: "/cover.webp"
tags: [Astro, Svelte]
category: "Tech"
lang: "zh-CN"
pinned: true
author: "Author"
sourceLink: "https://example.com"
licenseName: "CC BY 4.0"
licenseUrl: "https://example.com/license"
comment: false
---

# Body
`;

test("解析受支持 frontmatter 和正文", () => {
	assert.deepEqual(parsePostMarkdown(markdown, "hello-firefly"), {
		slug: "hello-firefly",
		title: "Hello: Firefly",
		published: "2026-08-27",
		description: "line one",
		aiSummary: "summary",
		image: "/cover.webp",
		tags: ["Astro", "Svelte"],
		category: "Tech",
		lang: "zh-CN",
		pinned: true,
		author: "Author",
		sourceLink: "https://example.com",
		licenseName: "CC BY 4.0",
		licenseUrl: "https://example.com/license",
		comment: false,
		content: "# Body\n",
	});
});

test("序列化后再次解析保持字段一致", () => {
	const parsed = parsePostMarkdown(markdown, "hello-firefly");
	assert.deepEqual(parsePostMarkdown(toMarkdown(parsed), "hello-firefly"), parsed);
});

test("拒绝 MDX、密码字段、未知字段和 YAML alias", () => {
	for (const value of [
		"---\ntitle: A\npublished: 2026-08-27\npassword: secret\n---\nBody",
		"---\ntitle: A\npublished: 2026-08-27\nlayout: ../../x\n---\nBody",
		"---\ntitle: &title A\npublished: 2026-08-27\ndescription: *title\n---\nBody",
		"---\ntitle: A\npublished: 2026-08-27\n---\nimport X from './x'",
	]) assert.throws(() => parsePostMarkdown(value, "safe-slug"));
});

test("拒绝非法路径 slug、缺失标题和无效日期", () => {
	assert.throws(() => parsePostMarkdown(markdown, "../escape"));
	assert.throws(() => parsePostMarkdown("---\npublished: 2026-08-27\n---\nBody", "safe"));
	assert.throws(() => parsePostMarkdown("---\ntitle: A\npublished: tomorrow\n---\nBody", "safe"));
});
```

- [ ] **Step 3: 运行测试并确认导出缺失**

Run: `pnpm exec tsx --test tests/admin/markdown-parser.test.ts`

Expected: FAIL，提示 `parsePostMarkdown` 未导出。

- [ ] **Step 4: 拆出安全策略并实现严格解析器**

先把现有 `forbiddenMarkdown`、`validateContent` 和 `validateMarkdown` 移到 `markdown-policy.ts`；`validation.ts` 改从该文件导入 `validateContent`，`markdown.ts` 也从该文件导入并重新导出两个校验函数，以保持既有调用兼容。这样 `markdown.ts → validation.ts → markdown-policy.ts`，不会形成 `markdown.ts ↔ validation.ts` 循环依赖。

`markdown.ts` 新增 `parseDocument` 解析。允许字段集合固定为：`title,published,updated,draft,description,aiSummary,image,tags,category,lang,pinned,author,sourceLink,licenseName,licenseUrl,comment`。解析流程必须：

```ts
import { parseDocument } from "yaml";
import { ApiError } from "./errors";
import type { DraftInput } from "./types";
import { validateDraft } from "./validation";

const allowedFrontmatterKeys = new Set([
	"title", "published", "updated", "draft", "description", "aiSummary", "image",
	"tags", "category", "lang", "pinned", "author", "sourceLink", "licenseName",
	"licenseUrl", "comment",
]);

export const parsePostMarkdown = (value: string, slug: string): DraftInput => {
	if (!value.startsWith("---\n") || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
		throw new ApiError(422, "markdown_invalid", "Markdown 无效");
	const closing = value.indexOf("\n---\n", 4);
	if (closing < 0) throw new ApiError(422, "markdown_invalid", "Markdown 无效");
	const source = value.slice(4, closing);
	if (/[&*][A-Za-z0-9_-]+/.test(source))
		throw new ApiError(422, "markdown_alias_forbidden", "Markdown frontmatter 不允许 alias");
	const document = parseDocument(source, { schema: "core", prettyErrors: false });
	if (document.errors.length)
		throw new ApiError(422, "markdown_frontmatter_invalid", "Markdown frontmatter 无效");
	const metadata = document.toJS({ maxAliasCount: 0 }) as unknown;
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
		throw new ApiError(422, "markdown_frontmatter_invalid", "Markdown frontmatter 无效");
	const fields = metadata as Record<string, unknown>;
	if (Object.keys(fields).some((key) => !allowedFrontmatterKeys.has(key)))
		throw new ApiError(422, "markdown_field_unsupported", "Markdown 包含后台不支持的字段");
	const body = value.slice(closing + 5).replace(/^\n/, "");
	const checked = validateDraft({ ...fields, slug, content: body });
	if (!checked.data)
		throw new ApiError(422, "markdown_invalid", "Markdown 无效", false, Object.fromEntries(checked.errors.map((error) => [error, error])));
	return checked.data;
};
```

同时调整 `toMarkdown()`：日期和字符串继续安全引号化；只输出上述允许字段；`draft` 默认由调用方参数决定。将签名改为 `toMarkdown(draft: DraftInput, published = false)`，输出 `draft: ${!published}`，同步将 `PublishService` 的 `.replace("draft: true", "draft: false")` 改为 `toMarkdown(input, true)`。

- [ ] **Step 5: 运行解析器与发布测试**

Run: `pnpm exec tsx --test tests/admin/markdown-parser.test.ts tests/admin/publish-service.test.ts`

Expected: Markdown 4 tests PASS，既有发布服务测试全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add package.json pnpm-lock.yaml functions/api/admin/_shared/markdown-policy.ts functions/api/admin/_shared/markdown.ts functions/api/admin/_shared/validation.ts functions/api/admin/_shared/services/publish-service.ts tests/admin/markdown-parser.test.ts tests/admin/publish-service.test.ts
git commit -m "feat: add safe post markdown parser"
```

---

### Task 3: 扩展受控 GitHub Gateway

**Files:**
- Modify: `functions/api/admin/_shared/github.ts`
- Create: `tests/admin/github-gateway.test.ts`

- [ ] **Step 1: 写 Gateway 失败测试**

测试用受控 `globalThis.fetch` 依次覆盖：递归 tree 只返回 `src/content/posts/<slug>/index.md`；按 commit ref 读取文件；历史请求携带 `path` 和 `sha=master`；重命名依次读取 branch ref、base commit、base tree，创建含旧路径 `sha:null` 与新路径 blob SHA 的 tree，最后更新 `refs/heads/master`；删除 tree 只含目标路径 `sha:null`。关键断言：

```ts
assert.deepEqual(await listGitHubPostPaths(config), [
	"src/content/posts/alpha/index.md",
	"src/content/posts/beta/index.md",
]);
assert.equal(requests.at(-1)?.method, "PATCH");
assert.deepEqual(renameTree.tree, [
	{ path: "src/content/posts/old/index.md", mode: "100644", type: "blob", sha: null },
	{ path: "src/content/posts/new/index.md", mode: "100644", type: "blob", sha: "new-blob" },
]);
assert.equal(deleteTree.tree[0].sha, null);
```

还要断言：任一源/目标路径不符合白名单时，在发出 fetch 前抛出 `path_not_allowed`；branch ref 当前 commit 与调用方 `expectedCommitSha` 不一致时抛出 `github_head_changed`；Contents API 返回目录对象或非 base64 文件时抛出受控读取错误。

- [ ] **Step 2: 运行测试并确认新 API 缺失**

Run: `pnpm exec tsx --test tests/admin/github-gateway.test.ts`

Expected: FAIL，提示 `listGitHubPostPaths`、`listGitHubFileHistory`、`commitGitHubRename` 和 `commitGitHubDelete` 未导出。

- [ ] **Step 3: 定义 Gateway DTO 和导出**

```ts
export type GitHubHistoryItem = {
	sha: string;
	message: string;
	authorName: string;
	authorDate: string;
};

export type GitHubTreeCommit = {
	blobSha: string | null;
	commitSha: string;
};

export const listGitHubPostPaths: (config: GitHubConfig) => Promise<string[]>;
export const getGitHubFileAtRef: (config: GitHubConfig, path: string, ref: string) => Promise<GitHubContent>;
export const listGitHubFileHistory: (config: GitHubConfig, path: string, page: number, pageSize: number) => Promise<GitHubHistoryItem[]>;
export const commitGitHubRename: (config: GitHubConfig, sourcePath: string, targetPath: string, content: string, expectedHeadCommitSha: string, message: string) => Promise<GitHubTreeCommit>;
export const commitGitHubDelete: (config: GitHubConfig, path: string, expectedHeadCommitSha: string, message: string) => Promise<GitHubTreeCommit>;
```

- [ ] **Step 4: 实现只读 API**

- `listGitHubPostPaths()` 调用 `GET /git/trees/{branch}?recursive=1`，只保留 `type === "blob"` 且通过 `isAllowedGitHubPath()` 的路径，按路径排序；响应 `truncated === true` 时抛出 `github_tree_truncated`，避免静默漏文章。
- `getGitHubFileAtRef()` 复用 Contents API，但将 `ref` 参数作为显式入参且长度限制 7–64，只接受十六进制 commit SHA。
- `listGitHubFileHistory()` 调用 `GET /commits?path=<path>&sha=<branch>&page=<page>&per_page=<pageSize>`，页大小限制 1–50，只映射 commit SHA、消息首行、作者名和 ISO 时间。

- [ ] **Step 5: 实现单提交 tree 写入**

`commitGitHubRename()` 和 `commitGitHubDelete()` 共用内部 `commitTreeChange()`：

```text
GET /git/ref/heads/{branch}
→ 比较 ref.object.sha 与 expectedHeadCommitSha
→ GET /git/commits/{headSha}
→ POST /git/blobs（重命名时创建目标内容）
→ POST /git/trees，base_tree 使用 base commit.tree.sha
→ POST /git/commits，parents 只有 headSha
→ PATCH /git/refs/heads/{branch}，force: false
```

重命名 tree 必须同时删除源路径并新增目标路径；删除 tree 只删除源路径。任何 `409/422` 映射为 `github_conflict`，不得自动读取新 HEAD 后重试。

- [ ] **Step 6: 运行 Gateway 和既有配置测试**

Run: `pnpm exec tsx --test tests/admin/github-gateway.test.ts tests/admin/github-config.test.ts`

Expected: 新增 Gateway tests 全部 PASS；既有 branch/compare tests 全部 PASS。

- [ ] **Step 7: 提交**

```bash
git add functions/api/admin/_shared/github.ts tests/admin/github-gateway.test.ts tests/admin/github-config.test.ts
git commit -m "feat: add controlled github content gateway"
```

---

### Task 4: 实现修订 Repository 与已发布文章修订

**Files:**
- Create: `functions/api/admin/_shared/repositories/revision-repository.ts`
- Modify: `functions/api/admin/_shared/repositories/draft-repository.ts`
- Modify: `functions/api/admin/_shared/services/content-service.ts`
- Modify: `functions/api/admin/_shared/services/publish-service.ts`
- Modify: `functions/api/admin/drafts/[id].ts`
- Modify: `functions/api/admin/drafts/[id]/publish.ts`
- Create: `functions/api/admin/drafts/[id]/revisions.ts`
- Modify: `functions/api/admin/_shared/contracts.ts`
- Modify: `tests/admin/content-service.test.ts`
- Modify: `tests/admin/publish-service.test.ts`

- [ ] **Step 1: 写修订状态失败测试**

在 `content-service.test.ts` 增加：已发布同步文章 `assertEditable()` 不抛错；保存后的 `nextSyncStatus("published", "published")` 返回 `modified`；草稿返回 `local`；`toDetail()` 包含 Task 1 的 capabilities。在 `publish-service.test.ts` 增加：`published/modified` 使用绑定 SHA 更新原路径；`withdrawn/local` 在原路径不存在时创建；`published/published` 因无修订返回 `content_not_modified`。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm exec tsx --test tests/admin/content-service.test.ts tests/admin/publish-service.test.ts`

Expected: FAIL，原因包括已发布文章仍抛 `draft_immutable`、缺少 `nextSyncStatus` 和 capabilities。

- [ ] **Step 3: 实现 RevisionRepository**

接口固定为：

```ts
export class RevisionRepository {
	constructor(private readonly env: Env) {}
	create(row: ContentRevisionRow): Promise<void>;
	list(draftId: string, limit: number, offset: number): Promise<ContentRevisionRow[]>;
	count(draftId: string): Promise<number>;
	getByVersion(draftId: string, version: number): Promise<ContentRevisionRow | null>;
}
```

`create()` 使用全字段参数化 INSERT；`list()` 只选择 `id,draft_id,content_id,version,source,title,slug,content_sha256,github_blob_sha,github_commit_sha,created_by,created_at`，不返回 Markdown；详情只有 `getByVersion()` 返回 Markdown。

- [ ] **Step 4: 使保存成为版本化修订**

`DraftRepository.update()` 改为 D1 batch：第一个语句条件更新 `WHERE id = ? AND version = ? AND deleted_at IS NULL`；`sync_status` 使用服务端计算值，已发布文章从 `published` 变为 `modified`，其他可编辑状态变为 `local`；第二个语句以新版本写 `admin_content_revisions`。batch 后必须验证两个语句各变更 1 行，否则返回 null；不允许先更新后异步补快照。

处理器将 `context.session.user_id`、`toMarkdown(checked.data, current.status === "published")` 和 SHA-256 摘要传入 Repository。`assertEditable()` 改为调用 `contentCapabilities()`，而不是禁止所有 `published`。

- [ ] **Step 5: 调整发布语义**

`PublishService` 增加 Revision store 依赖并遵守：

```ts
if (draft.status === "published" && draft.sync_status === "published")
	throw new ApiError(409, "content_not_modified", "文章没有待发布修订");
```

- `published/modified`：目标仍使用已绑定 `github_path`，不能从新 slug 隐式推导迁移；编辑器在该状态禁用 slug 字段，重命名只能走 Task 7。
- `withdrawn/local`：目标使用当前 slug 推导路径，远端必须不存在，成功后恢复 published 流程。
- 发布任务完成回调继续把状态收敛为 `published/published`。
- 创建发布任务前写 `source="publish"` 快照；相同 `(draft_id, version)` 已存在时按唯一约束视为幂等成功。

- [ ] **Step 6: 增加修订列表端点**

`GET /api/admin/drafts/:id/revisions?page=1&pageSize=20` 返回：

```ts
export type ContentRevisionSummaryDto = {
	id: string;
	version: number;
	source: "save" | "import" | "publish" | "rollback";
	title: string;
	slug: string;
	contentSha256: string;
	githubBlobSha: string | null;
	githubCommitSha: string | null;
	createdAt: string;
};
```

响应同样使用 `{ items, page, pageSize, total }`；pageSize 上限 50；不存在或已软删除文章返回 404。

- [ ] **Step 7: 验证完整后台测试**

Run: `pnpm test:admin && pnpm check && pnpm type-check`

Expected: 全部 admin tests PASS；Astro diagnostics 和 TypeScript 均无错误。

- [ ] **Step 8: 提交**

```bash
git add functions/api/admin/_shared/repositories/revision-repository.ts functions/api/admin/_shared/repositories/draft-repository.ts functions/api/admin/_shared/services/content-service.ts functions/api/admin/_shared/services/publish-service.ts functions/api/admin/drafts/[id].ts functions/api/admin/drafts/[id]/publish.ts functions/api/admin/drafts/[id]/revisions.ts functions/api/admin/_shared/contracts.ts tests/admin/content-service.test.ts tests/admin/publish-service.test.ts
git commit -m "feat: support published post revisions"
```

---

### Task 5: 实现导入 GitHub 已有文章

**Files:**
- Create: `functions/api/admin/_shared/repositories/content-operation-repository.ts`
- Create: `functions/api/admin/_shared/services/content-operation-service.ts`
- Create: `functions/api/admin/imports/posts.ts`
- Modify: `functions/api/admin/_shared/repositories/draft-repository.ts`
- Modify: `functions/api/admin/_shared/contracts.ts`
- Create: `tests/admin/content-operation-service.test.ts`

- [ ] **Step 1: 写导入服务失败测试**

使用内存 Draft store、Operation store 和 GitHub gateway 覆盖：

```ts
test("导入远端 Markdown 建立不可变 contentId 与 SHA 绑定", async () => {
	const result = await service.importPost({
		path: "src/content/posts/hello/index.md",
		userId: "user-1",
		idempotencyKey: "import-hello-1",
	});
	assert.equal(result.status, "published");
	assert.equal(result.syncStatus, "published");
	assert.equal(result.githubPath, "src/content/posts/hello/index.md");
	assert.equal(result.githubSha, "blob-1");
	assert.equal(result.commitSha, "commit-head");
	assert.equal(githubWrites, 0);
});

test("重复幂等键返回同一导入结果", async () => {
	const first = await importOnce();
	const second = await importOnce();
	assert.equal(second.id, first.id);
	assert.equal(createdDrafts, 1);
});

test("已绑定路径、已存在 slug 和不支持 Markdown 均拒绝导入", async () => {
	await assert.rejects(() => service.importPost(boundInput), hasCode("content_already_imported"));
	await assert.rejects(() => service.importPost(duplicateSlugInput), hasCode("content_slug_conflict"));
	await assert.rejects(() => service.importPost(mdxInput), hasCode("markdown_field_unsupported"));
});
```

另测候选列表将 gateway 路径与 `DraftRepository.listBindingsByPaths()` 合并为 `{ path, slug, imported, draftId }`，不得下载所有正文。

- [ ] **Step 2: 运行测试并确认服务缺失**

Run: `pnpm exec tsx --test tests/admin/content-operation-service.test.ts`

Expected: FAIL，提示 `ContentOperationService` 未定义。

- [ ] **Step 3: 实现操作 Repository**

提供 `findByIdempotencyKey()`、`findActiveByDraftId()`、`createPending()`、`markGitHubCommitted()`、`markCompleted()`、`markReconciliationRequired()`、`markFailed()` 和 `get()`。所有状态变化必须使用 `WHERE id = ? AND status = ?`；错误只保存受控 code；重复键必须读取既有记录并核对 type、contentId、userId 和 expectedVersion。

- [ ] **Step 4: 实现原子导入绑定**

`DraftRepository.importPublished()` 使用 D1 batch 写入：

1. `admin_drafts`：随机 `id/content_id`，解析字段，`status='published'`、`sync_status='published'`、`github_path/path`、`github_sha/blobSha`、`commit_sha/headCommitSha`、`version=1`。
2. `admin_content_revisions`：`source='import'`、完整 Markdown、摘要和 GitHub 证据。
3. 将对应 operation 从 `pending` 条件更新为 `completed`。

三个语句必须全部验证；唯一键冲突映射为 `content_slug_conflict` 或 `content_already_imported`。远端读取顺序为 `get branch HEAD → get file at HEAD → decode → parsePostMarkdown → hash → D1 batch`，期间不调用任何 GitHub 写方法。

- [ ] **Step 5: 实现导入 API**

- `GET /api/admin/imports/posts?page=1&pageSize=20`：读取 tree 路径，内存分页后批量查询绑定，返回 `PostImportCandidatePageDto`；最大展示 50 条。
- `POST /api/admin/imports/posts` 请求固定为 `{ path: string, idempotencyKey: string }`，路径必须通过白名单且 idempotencyKey 长度 8–128。
- 成功返回 `DraftDetailDto` 和 201；审计 action 为 `post_import`，metadata 只含 path、blob SHA、commit SHA，不含 Markdown。

- [ ] **Step 6: 运行导入、Markdown 和契约测试**

Run: `pnpm exec tsx --test tests/admin/content-operation-service.test.ts tests/admin/markdown-parser.test.ts tests/admin/contracts.test.ts`

Expected: 全部 PASS。

- [ ] **Step 7: 提交**

```bash
git add functions/api/admin/_shared/repositories/content-operation-repository.ts functions/api/admin/_shared/services/content-operation-service.ts functions/api/admin/imports/posts.ts functions/api/admin/_shared/repositories/draft-repository.ts functions/api/admin/_shared/contracts.ts tests/admin/content-operation-service.test.ts
git commit -m "feat: import existing github posts"
```

---

### Task 6: 实现参数化文章筛选后端

**Files:**
- Create: `functions/api/admin/_shared/services/post-query.ts`
- Modify: `functions/api/admin/_shared/repositories/draft-repository.ts`
- Modify: `functions/api/admin/drafts/index.ts`
- Modify: `functions/api/admin/_shared/contracts.ts`
- Create: `tests/admin/post-query.test.ts`

- [ ] **Step 1: 写查询构造失败测试**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildPostQuery, parsePostFilters } from "../../functions/api/admin/_shared/services/post-query";

test("规范化搜索、状态、标签和分类", () => {
	assert.deepEqual(parsePostFilters(new URL("https://x.test/?q=%20Astro%20&status=published&tag=Svelte&category=Tech&page=2&pageSize=25")), {
		query: "Astro",
		status: "published",
		tag: "Svelte",
		category: "Tech",
		page: 2,
		pageSize: 25,
	});
});

test("未知状态和超长筛选返回 validation_failed", () => {
	assert.throws(() => parsePostFilters(new URL("https://x.test/?status=unknown")));
	assert.throws(() => parsePostFilters(new URL(`https://x.test/?q=${"a".repeat(201)}`)));
});

test("SQL 只包含占位符且 list/count 参数一致", () => {
	const result = buildPostQuery({ query: "x%' OR 1=1 --", status: "published", tag: "Astro", category: "Tech", page: 1, pageSize: 20 });
	assert.doesNotMatch(result.whereSql, /OR 1=1/);
	assert.deepEqual(result.params, ["%x%' OR 1=1 --%", "%x%' OR 1=1 --%", "published", "Astro", "Tech"]);
});
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `pnpm exec tsx --test tests/admin/post-query.test.ts`

Expected: FAIL，提示无法解析 `post-query`。

- [ ] **Step 3: 实现筛选解析和 SQL**

筛选类型固定为：

```ts
export type PostFilters = {
	query: string;
	status: "all" | "draft" | "published" | "withdrawn" | "build_failed";
	tag: string;
	category: string;
	page: number;
	pageSize: number;
};
```

`WHERE` 永远包含 `deleted_at IS NULL`。搜索使用 `(title LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\')`；先转义 `\`、`%`、`_` 再包 `%`。标签使用 `EXISTS (SELECT 1 FROM json_each(admin_drafts.tags_json) WHERE json_each.value = ?)`；分类精确匹配；状态 `all` 不附加条件。list 和 count 共用同一 `whereSql/params`。

- [ ] **Step 4: 接入 Repository 与 Handler**

`DraftRepository.list(filters)` 使用 `ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`；`count(filters)` 使用相同 where。列表摘要增加 `tags`、`category`、`published` 和 capabilities，仍不得包含 `content`。Handler 对非法筛选返回 422 `validation_failed`，不静默回退。

- [ ] **Step 5: 运行查询与 DTO 测试**

Run: `pnpm exec tsx --test tests/admin/post-query.test.ts tests/admin/content-service.test.ts && pnpm check`

Expected: 全部 PASS，Astro diagnostics 无错误。

- [ ] **Step 6: 提交**

```bash
git add functions/api/admin/_shared/services/post-query.ts functions/api/admin/_shared/repositories/draft-repository.ts functions/api/admin/drafts/index.ts functions/api/admin/_shared/contracts.ts tests/admin/post-query.test.ts tests/admin/content-service.test.ts
git commit -m "feat: add post search and filters"
```

---

### Task 7: 实现原子重命名

**Files:**
- Modify: `functions/api/admin/_shared/services/content-operation-service.ts`
- Modify: `functions/api/admin/_shared/repositories/draft-repository.ts`
- Create: `functions/api/admin/drafts/[id]/rename.ts`
- Modify: `tests/admin/content-operation-service.test.ts`

- [ ] **Step 1: 写重命名失败测试**

覆盖：只有 `published/published` 可重命名；新 slug 经严格校验；目标路径存在时不写 GitHub；branch HEAD、绑定 commit 和 blob 证据不一致时冲突；成功时 gateway 只收到一次 `renameFile`，随后 D1 更新 slug/path/blob/commit/version；GitHub 成功后 D1 失败进入 `reconciliation_required`；重复 idempotencyKey 不重复提交。

关键成功断言：

```ts
assert.deepEqual(renameCalls, [{
	sourcePath: "src/content/posts/old/index.md",
	targetPath: "src/content/posts/new/index.md",
	expectedBlobSha: "blob-old",
	expectedHeadCommitSha: "commit-head",
}]);
assert.equal(result.slug, "new");
assert.equal(result.version, 5);
```

- [ ] **Step 2: 运行测试并确认 rename 尚未实现**

Run: `pnpm exec tsx --test tests/admin/content-operation-service.test.ts`

Expected: FAIL，提示 `renamePost` 不存在或断言失败。

- [ ] **Step 3: 实现服务编排**

执行顺序固定为：

```text
按幂等键返回既有结果
→ 读取 draft 并检查 expectedVersion、published/published 和绑定证据
→ 推导 sourcePath/targetPath
→ 检查 targetPath 不存在
→ 读取 sourcePath 并校验 expected blob SHA
→ 创建 pending operation
→ 调用 commitGitHubRename 单提交迁移
→ operation 标记 github_committed
→ 条件更新 D1 slug/path/blob/commit/version
→ operation 标记 completed
```

GitHub 成功后的任何 D1 失败必须保存新 blob/commit，并将 draft `sync_status` 尽力标为 `reconciliation_required`。不得自动回迁路径。

- [ ] **Step 4: 实现 Handler 契约**

`POST /api/admin/drafts/:id/rename` 请求：

```ts
{
	newSlug: string;
	expectedVersion: number;
	idempotencyKey: string;
}
```

服务端不接收 path、SHA、commit message。成功返回更新后的 `DraftDetailDto`；冲突使用 409；审计 action `post_rename`，metadata 为 oldSlug/newSlug/operationId/commitSha。

- [ ] **Step 5: 运行测试和类型检查**

Run: `pnpm exec tsx --test tests/admin/content-operation-service.test.ts && pnpm type-check`

Expected: 全部 PASS，TypeScript 无错误。

- [ ] **Step 6: 提交**

```bash
git add functions/api/admin/_shared/services/content-operation-service.ts functions/api/admin/_shared/repositories/draft-repository.ts functions/api/admin/drafts/[id]/rename.ts tests/admin/content-operation-service.test.ts
git commit -m "feat: add atomic post rename"
```

---

### Task 8: 实现撤回与软删除

**Files:**
- Modify: `functions/api/admin/_shared/services/content-operation-service.ts`
- Modify: `functions/api/admin/_shared/repositories/draft-repository.ts`
- Create: `functions/api/admin/drafts/[id]/withdraw.ts`
- Modify: `functions/api/admin/drafts/[id].ts`
- Modify: `tests/admin/content-operation-service.test.ts`
- Modify: `tests/admin/content-service.test.ts`

- [ ] **Step 1: 写撤回和删除失败测试**

撤回覆盖：仅 `published/published`；远端文件必须存在且 blob SHA 与绑定一致；gateway 删除使用 branch HEAD；成功后 `status='withdrawn'`、`sync_status='local'`、`github_sha=NULL`、保留 `github_path` 和最后 `commit_sha`、版本 +1；部分成功进入待对账。

删除覆盖：`published` 直接删除返回 `content_must_be_withdrawn`；`draft`、`withdrawn`、`build_failed` 使用 `expectedVersion` 和标题确认软删除；存在活动 publish/content operation 时返回 `content_operation_active`；成功只设置 `deleted_at` 和版本，不删除修订、发布任务、操作或审计。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm exec tsx --test tests/admin/content-operation-service.test.ts tests/admin/content-service.test.ts`

Expected: FAIL，原因是现有 DELETE 仍物理删除且没有 withdraw。

- [ ] **Step 3: 实现撤回服务与端点**

`POST /api/admin/drafts/:id/withdraw` 请求固定为：

```ts
{
	expectedVersion: number;
	idempotencyKey: string;
	confirmationTitle: string;
}
```

标题必须与服务端当前标题完全一致。编排与重命名相同，但 gateway 调用 `commitGitHubDelete()`；GitHub 成功后条件更新 D1。成功审计 action 为 `post_withdraw`。

- [ ] **Step 4: 改造 DELETE 为软删除**

请求 body 固定为 `{ expectedVersion: number, confirmationTitle: string }`。`DraftRepository.softDelete()` SQL：

```sql
UPDATE admin_drafts
SET deleted_at = ?, updated_at = ?, version = version + 1
WHERE id = ? AND version = ? AND deleted_at IS NULL
```

Handler 检查 capabilities、活动发布任务、活动内容操作和标题。删除成功返回 `{ deleted: true }`；并发失败返回 409 `content_version_conflict`。所有 get/list/count 默认排除 `deleted_at IS NOT NULL`。

- [ ] **Step 5: 验证测试和本地迁移状态**

Run: `pnpm test:admin && pnpm admin:db:local && pnpm check`

Expected: 全部测试 PASS，无待应用迁移，Astro diagnostics 无错误。

- [ ] **Step 6: 提交**

```bash
git add functions/api/admin/_shared/services/content-operation-service.ts functions/api/admin/_shared/repositories/draft-repository.ts functions/api/admin/drafts/[id]/withdraw.ts functions/api/admin/drafts/[id].ts tests/admin/content-operation-service.test.ts tests/admin/content-service.test.ts
git commit -m "feat: add post withdrawal and soft delete"
```

---

### Task 9: 实现 GitHub 历史、差异与回滚

**Files:**
- Create: `functions/api/admin/_shared/services/line-diff.ts`
- Create: `tests/admin/line-diff.test.ts`
- Create: `functions/api/admin/drafts/[id]/history.ts`
- Create: `functions/api/admin/drafts/[id]/history/[sha].ts`
- Create: `functions/api/admin/drafts/[id]/rollback.ts`
- Modify: `functions/api/admin/_shared/services/content-operation-service.ts`
- Modify: `functions/api/admin/_shared/repositories/draft-repository.ts`
- Modify: `functions/api/admin/_shared/contracts.ts`
- Modify: `tests/admin/content-operation-service.test.ts`

- [ ] **Step 1: 写文本差异失败测试**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { lineDiff } from "../../functions/api/admin/_shared/services/line-diff";

test("输出稳定的相同、删除和新增行", () => {
	assert.deepEqual(lineDiff("a\nb\nc\n", "a\nx\nc\n"), [
		{ type: "context", oldLine: 1, newLine: 1, text: "a" },
		{ type: "remove", oldLine: 2, newLine: null, text: "b" },
		{ type: "add", oldLine: null, newLine: 2, text: "x" },
		{ type: "context", oldLine: 3, newLine: 3, text: "c" },
	]);
});

test("拒绝超过差异上限的输入", () => {
	assert.throws(() => lineDiff("a\n".repeat(5001), "b\n"));
});
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `pnpm exec tsx --test tests/admin/line-diff.test.ts`

Expected: FAIL，提示无法解析 `line-diff`。

- [ ] **Step 3: 实现有界 LCS 行差异**

输入各自最多 5000 行、500000 字符；超限抛 422 `diff_too_large`。使用两行滚动 LCS 长度矩阵和回溯决策数组，输出：

```ts
export type DiffLine = {
	type: "context" | "add" | "remove";
	oldLine: number | null;
	newLine: number | null;
	text: string;
};
```

不得输出 HTML；前端以文本节点渲染。

- [ ] **Step 4: 实现历史 API**

- `GET /drafts/:id/history?page=1&pageSize=20`：仅使用服务端 `github_path`，返回 `GitHubHistoryItemDto[]`；未绑定返回空页；pageSize 上限 50。
- `GET /drafts/:id/history/:sha`：验证 40 位十六进制 SHA；分别读取该 SHA 和当前绑定 commit 的 Markdown，返回 `{ commit, markdown, parsed, diff }`。解析失败时仍返回原始 Markdown 和 diff，但 `parsed:null`、`editable:false`，不得把不受支持内容送入编辑器。

- [ ] **Step 5: 写回滚服务测试**

覆盖：只有 `published/published` 可回滚；source commit 必须属于该路径历史；历史 Markdown 必须通过严格解析；当前远端 blob 和 HEAD 必须匹配绑定证据；回滚通过 `updateFile` 写当前路径，不改变 contentId；成功同步 D1 字段、version+1、写 `source='rollback'` 修订并完成 operation；GitHub 成功/D1 失败进入待对账；回滚到当前内容返回 `content_already_current` 且不写 GitHub。

- [ ] **Step 6: 实现回滚端点**

`POST /drafts/:id/rollback` 请求：

```ts
{
	sourceCommitSha: string;
	expectedVersion: number;
	idempotencyKey: string;
	confirmationTitle: string;
}
```

服务端按历史 commit 读取内容，严格解析，以当前 blob SHA 调用 GitHub update，提交消息为 `Rollback <slug> to <短SHA>`。D1 batch 更新工作副本和绑定、写 rollback 修订、完成 operation。成功审计 `post_rollback`；metadata 只含 sourceCommitSha/resultCommitSha/operationId。

- [ ] **Step 7: 实现内容操作对账端点**

`POST /api/admin/content-operations/:id/reconcile` 只接受 `reconciliation_required`。按 operation type 验证：rename 的目标存在且源不存在；withdraw 的源不存在且 HEAD 为记录 commit；rollback 的目标 blob 等于 resultBlobSha；import 不产生待对账。证据一致时重放对应 D1 条件更新并完成 operation；不一致返回 409 `reconciliation_evidence_mismatch` 且保持状态。

- [ ] **Step 8: 运行历史、操作和类型测试**

Run: `pnpm exec tsx --test tests/admin/line-diff.test.ts tests/admin/content-operation-service.test.ts && pnpm type-check`

Expected: 全部 PASS，TypeScript 无错误。

- [ ] **Step 9: 提交**

```bash
git add functions/api/admin/_shared/services/line-diff.ts tests/admin/line-diff.test.ts functions/api/admin/drafts/[id]/history.ts functions/api/admin/drafts/[id]/history/[sha].ts functions/api/admin/drafts/[id]/rollback.ts functions/api/admin/content-operations/[id]/reconcile.ts functions/api/admin/_shared/services/content-operation-service.ts functions/api/admin/_shared/repositories/draft-repository.ts functions/api/admin/_shared/contracts.ts tests/admin/content-operation-service.test.ts
git commit -m "feat: add post history and rollback"
```

---

### Task 10: 将筛选状态持久化到后台 URL

**Files:**
- Create: `src/components/admin/post-filters.ts`
- Modify: `src/components/admin/admin-types.ts`
- Modify: `src/components/admin/admin-router.ts`
- Modify: `tests/admin/admin-router.test.ts`
- Create: `tests/admin/post-filters.test.ts`

- [ ] **Step 1: 写 URL 与请求参数失败测试**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { formatAdminUrl, parseAdminRoute } from "../../src/components/admin/admin-router";
import { postFilterQuery } from "../../src/components/admin/post-filters";

const route = {
	view: "posts" as const,
	resourceId: "draft-1",
	postFilters: { query: "Astro Svelte", status: "published" as const, tag: "Svelte", category: "Tech", page: 3 },
};

test("文章筛选可从 URL 恢复并再次格式化", () => {
	const url = formatAdminUrl(route);
	assert.equal(url, "/admin/?view=posts&id=draft-1&q=Astro+Svelte&status=published&tag=Svelte&category=Tech&page=3");
	assert.deepEqual(parseAdminRoute(`https://example.com${url}`), route);
});

test("默认筛选不污染 URL", () => {
	assert.equal(formatAdminUrl({ view: "posts", resourceId: null, postFilters: { query: "", status: "all", tag: "", category: "", page: 1 } }), "/admin/?view=posts");
});

test("筛选生成编码后的 API query", () => {
	assert.equal(postFilterQuery(route.postFilters, 20), "q=Astro+Svelte&status=published&tag=Svelte&category=Tech&page=3&pageSize=20");
});
```

- [ ] **Step 2: 运行测试并确认类型/行为失败**

Run: `pnpm exec tsx --test tests/admin/admin-router.test.ts tests/admin/post-filters.test.ts`

Expected: FAIL，现有 `AdminRoute` 没有 `postFilters`，且模块缺失。

- [ ] **Step 3: 扩展路由类型和纯函数**

```ts
export type PostFilterState = {
	query: string;
	status: "all" | "draft" | "published" | "withdrawn" | "build_failed";
	tag: string;
	category: string;
	page: number;
};

export type AdminRoute = {
	view: AdminView;
	resourceId: string | null;
	postFilters: PostFilterState;
};
```

非 posts 视图也携带默认筛选，确保类型稳定；格式化时只有 posts 输出非默认值。解析规则与后端一致，但非法/超长 URL 值在客户端回退默认值，服务端仍是最终校验者。`postFilterQuery()` 总是带 page/pageSize。

- [ ] **Step 4: 更新既有路由断言**

所有 `AdminRoute` 预期对象加入默认 `postFilters`。`pushAdminRoute` 和 `replaceAdminRoute` 保留筛选；从文章切到媒体再返回文章时由 `AdminApp` 保存最后一次筛选状态。

- [ ] **Step 5: 运行前端纯函数测试**

Run: `pnpm exec tsx --test tests/admin/admin-router.test.ts tests/admin/post-filters.test.ts tests/admin/pagination.test.ts`

Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/components/admin/post-filters.ts src/components/admin/admin-types.ts src/components/admin/admin-router.ts tests/admin/admin-router.test.ts tests/admin/post-filters.test.ts
git commit -m "feat: persist post filters in admin urls"
```

---

### Task 11: 实现筛选、导入、历史和危险操作 UI

**Files:**
- Create: `src/components/admin/PostImportDialog.svelte`
- Create: `src/components/admin/PostHistoryPanel.svelte`
- Create: `src/components/admin/PostDangerActions.svelte`
- Modify: `src/components/admin/PostListView.svelte`
- Modify: `src/components/admin/PostEditorView.svelte`
- Modify: `src/components/admin/AdminApp.svelte`
- Modify: `src/components/admin/admin-types.ts`
- Modify: `src/styles/admin.css`

- [ ] **Step 1: 对齐前端 DTO**

在 `admin-types.ts` 精确镜像后端：ContentStatus、ContentSyncStatus、ContentCapabilities、ContentOperation、PostImportCandidate/Page、ContentRevisionSummary/Page、GitHubHistoryItem/Page、HistoryDetail 和 DiffLine。`DraftSummary` 增加 `published,tags,category,capabilities`；`DraftDetail` 继承这些字段。不得在前端重新推导危险操作权限。

- [ ] **Step 2: 实现筛选列表**

`PostListView` props 改为：

```ts
filters: PostFilterState;
onfilters: (filters: PostFilterState) => void;
onimport: () => void;
```

提供搜索 input、状态 select、标签 input、分类 input、清除筛选和导入按钮。文本筛选使用 300ms debounce；任一筛选变化把 page 重置为 1；分页变化保留其他筛选。列表显示状态、`syncStatus === "modified"` 的“有未发布修订”徽标、分类和标签。空状态区分“库中无文章”和“当前筛选无结果”。

- [ ] **Step 3: 实现导入对话框**

打开时请求 `/imports/posts?page=1&pageSize=20`；显示 path/slug/是否已导入；已导入项禁用；确认后 POST `{ path, idempotencyKey: crypto.randomUUID() }`。成功关闭对话框、刷新当前列表并导航到新 draft ID。失败保留对话框和选择，不显示第三方原始响应。

- [ ] **Step 4: 实现历史面板**

编辑器按需打开面板后才请求 `/drafts/:id/history`。选择 commit 后请求详情；diff 每行使用 Svelte 文本插值，不使用 `{@html}`。`editable:false` 显示“该版本含后台不支持字段，只能查看”。回滚按钮仅在 capabilities.renameable 为 true 时可用；提交 Task 9 契约并在成功后重新加载详情与历史。

- [ ] **Step 5: 实现危险操作组件**

- 重命名：只在 `renameable` 显示；输入新 slug，确认框展示 old → new；POST rename 契约。
- 撤回：只在 `withdrawable` 显示；要求输入完整标题；POST withdraw 契约。
- 删除：只在 `deletable` 显示；要求输入完整标题；DELETE body 带 expectedVersion/title。
- 所有操作期间禁用重复提交；使用 `crypto.randomUUID()` 作为幂等键；收到 `reconciliation_required` 时展示对账按钮而非成功消息。

- [ ] **Step 6: 接入编辑器修订状态**

`PostEditorView` 在 `published/published` 显示“线上版本”；首次修改后保存，服务端返回 `published/modified`，显示“未发布修订”。该状态禁用 slug input，并提示使用重命名操作。自动保存沿用阶段一顺序保护，间隔固定 30 秒且只在已有资源、dirty、非 saving、capabilities.editable 时触发；卸载时清理 timer。保存冲突继续保留本地表单。

- [ ] **Step 7: 接入 AdminApp 数据流**

`loadDrafts()` 使用 `postFilterQuery(route.postFilters, draftPageSize)`。筛选变化调用 `replaceAdminRoute()`，文章选择调用 `pushAdminRoute()` 并保留 filters。导入、重命名、撤回、回滚、删除成功后重新请求当前页，不手工猜测 total/status。保持现有媒体编辑器挂载和 beforeunload 保护。

- [ ] **Step 8: 添加响应式和无障碍样式**

在 `admin.css` 增加 `.admin-post-filters`、`.admin-dialog-backdrop`、`.admin-dialog`、`.admin-history-panel`、`.admin-diff-line`、`.admin-danger-zone` 和状态徽标。对话框使用 `role="dialog" aria-modal="true"`、可见标题、Escape 关闭、首个可交互元素聚焦；危险操作提交按钮使用现有 danger token。`max-width:820px` 下筛选单列、对话框占视口宽度；dark 和 reduced-motion 复用现有变量与规则。

- [ ] **Step 9: 运行前端检查**

Run: `pnpm test:admin && pnpm check && pnpm type-check && pnpm lint`

Expected: 所有测试 PASS；Astro/TypeScript/Biome 无错误；Biome 不产生范围外格式化改动。

- [ ] **Step 10: 提交**

```bash
git add src/components/admin/PostImportDialog.svelte src/components/admin/PostHistoryPanel.svelte src/components/admin/PostDangerActions.svelte src/components/admin/PostListView.svelte src/components/admin/PostEditorView.svelte src/components/admin/AdminApp.svelte src/components/admin/admin-types.ts src/styles/admin.css
git commit -m "feat: complete post management interface"
```

---

### Task 12: 端到端验证与恢复演练

**Files:**
- Verify: `functions/api/admin/**`
- Verify: `src/components/admin/**`
- Verify: `src/styles/admin.css`
- Verify: `migrations/0010_admin_complete_post_management.sql`

- [ ] **Step 1: 运行全量自动验证**

Run: `pnpm test:admin && pnpm check && pnpm type-check && pnpm lint && pnpm build`

Expected: 所有命令退出码为 0；构建完成 Pagefind 索引；无 TypeScript、Astro 或 Biome 错误。

- [ ] **Step 2: 准备隔离的本地 D1 状态**

先复制 `.wrangler/state` 到项目目录外的临时位置，再运行：

Run: `pnpm admin:db:local && pnpm admin:build`

Expected: 0010 迁移已应用，`dist` 成功生成。不得将真实 GitHub Token、管理员密码或回调 Secret 写入命令历史、截图或项目文件。

- [ ] **Step 3: 启动后台并验证统一列表**

Run: `pnpm admin:dev`

Expected: `http://127.0.0.1:8788/admin/` 可访问。验证搜索、状态/标签/分类筛选、分页、刷新、前进后退和深链接；Network 中列表响应不含 `content` 字段。

- [ ] **Step 4: 使用专用测试仓库验证导入和修订**

测试仓库分支必须为 `master`，且只使用临时文章。验证：导入候选不下载全部正文；导入后建立 path/blob/commit 绑定；已发布文章保存只产生 `published/modified`，线上文件不变；发布修订后部署成功收敛到 `published/published`。

- [ ] **Step 5: 验证冲突和部分成功恢复**

依次验证：目标 slug 已存在时导入/重命名返回 409 且不写 GitHub；外部修改远端 blob 后重命名、撤回、回滚均拒绝；在测试替身中模拟 GitHub 成功后 D1 失败，UI 显示待对账，证据一致时 reconcile 完成，证据不一致时保持待对账。

- [ ] **Step 6: 验证撤回、删除、历史与回滚**

确认重命名在 GitHub 只有一个 commit；撤回删除线上文件但保留 D1 历史；published 不能直接删除；withdrawn 输入正确标题后软删除且列表消失；历史差异不执行 HTML；回滚保持 contentId 不变并产生新 commit 和 rollback 修订。

- [ ] **Step 7: 验证交互与可访问性**

在桌面和 390px 移动宽度验证浅色、深色、reduced-motion、导入对话框键盘操作、Escape、焦点、筛选空状态、自动保存、两个标签页版本冲突和未保存离开保护。所有危险操作必须要求明确确认。

- [ ] **Step 8: 恢复环境并检查工作树**

停止本地服务，恢复原 `.wrangler/state`，删除项目外临时测试仓库凭据和 D1 副本。运行：

Run: `git status --short`

Expected: 只出现本计划列出的源文件、测试、迁移、`package.json` 和 `pnpm-lock.yaml`；不出现 `.wrangler/state`、`dist`、日志、Token、密码或数据库副本。

## 完成门槛

- GitHub 已有 `.md` 文章可安全导入；MDX、密码字段、未知 frontmatter、alias、HTML 和脚本不可导入。
- 草稿、已发布、存在修订、已撤回和构建失败文章在统一列表中可搜索、分页并按状态、标签、分类筛选；筛选可由 URL 恢复。
- 已发布文章编辑只修改 D1 工作副本，直到显式发布修订才改变线上文件。
- 重命名使用单个 Git tree commit，不能形成新旧路径同时短暂上线的中间状态。
- 撤回删除线上文件但保留后台内容与历史；删除是有版本/标题确认的软删除。
- 历史、差异和回滚只使用服务端绑定路径；回滚保持 `content_id` 不变并创建新 Git commit。
- 导入、重命名、撤回和回滚都有幂等操作证据；GitHub 成功/D1 失败进入可验证对账状态。
- 所有 SQL 值参数化，所有 GitHub 路径白名单化，前端不接收 Token、任意路径、任意提交消息或内部错误详情。
- `pnpm test:admin`、`pnpm check`、`pnpm type-check`、`pnpm lint`、`pnpm build` 全部通过。
