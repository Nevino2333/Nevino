# Admin Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 封堵后台发布覆盖风险，建立可恢复的发布任务、统一 API 契约、后台 URL 路由和可继续扩展的模块骨架。

**Architecture:** Cloudflare Pages Functions 通过统一安全包装器进入 Content/Publish Service，再访问 D1 Repository 与 GitHub Gateway。发布使用 D1 持久化状态机和幂等键；前端通过统一 API Client 消费 camelCase DTO，并使用查询参数保存后台路由状态。

**Tech Stack:** Astro 7、Svelte 5、TypeScript、Cloudflare Pages Functions、D1、GitHub Contents API、Web Crypto、Node.js 内置测试运行器、pnpm。

---

## 文件结构

### 新建

- `migrations/0008_admin_publish_tasks.sql`：内容身份、版本与发布任务表。
- `functions/api/admin/_shared/contracts.ts`：API DTO 与发布状态。
- `functions/api/admin/_shared/errors.ts`：统一错误和响应格式。
- `functions/api/admin/_shared/handler.ts`：Origin、认证、CSRF、request ID 与异常映射。
- `functions/api/admin/_shared/repositories/draft-repository.ts`：草稿显式列查询和状态更新。
- `functions/api/admin/_shared/repositories/publish-task-repository.ts`：发布任务持久化与条件更新。
- `functions/api/admin/_shared/services/publish-target.ts`：纯函数形式的首次发布/更新决策。
- `functions/api/admin/_shared/services/publish-service.ts`：幂等发布和对账编排。
- `functions/api/admin/publish-tasks/[id].ts`：发布任务查询。
- `functions/api/admin/publish-tasks/[id]/reconcile.ts`：待对账任务恢复。
- `src/components/admin/admin-types.ts`：前端 DTO 与路由类型。
- `src/components/admin/admin-api.ts`：统一请求、CSRF 和 401 处理。
- `src/components/admin/admin-router.ts`：后台查询参数路由。
- `src/components/admin/AdminShell.svelte`：后台外壳和导航。
- `src/components/admin/LoginView.svelte`：登录视图。
- `src/components/admin/DashboardView.svelte`：仪表盘视图。
- `src/components/admin/PostListView.svelte`：文章摘要列表。
- `src/components/admin/PostEditorView.svelte`：文章编辑与发布任务状态。
- `tests/admin/publish-target.test.ts`：发布目标安全决策测试。
- `tests/admin/admin-router.test.ts`：后台路由测试。

### 修改

- `functions/api/admin/_shared/types.ts`：Row 类型和 Env。
- `functions/api/admin/_shared/github.ts`：分离 create/update 语义。
- `functions/api/admin/_shared/auth.ts`：适配安全包装器。
- `functions/api/admin/_shared/audit.ts`：记录 request ID 和资源结果。
- `functions/api/admin/drafts/index.ts`：摘要列表与 DTO。
- `functions/api/admin/drafts/[id].ts`：详情 DTO 与统一错误。
- `functions/api/admin/drafts/[id]/publish.ts`：改为 PublishService 入口。
- `functions/api/admin/login.ts`、`logout.ts`、`session.ts`、`csrf.ts`、`bootstrap.ts`：统一响应契约。
- `src/components/admin/AdminApp.svelte`：降为状态装配和视图路由。
- `src/pages/admin/index.astro`、`src/pages/admin/login.astro`：统一 URL 恢复行为。
- `src/styles/admin.css`：发布任务和冲突状态样式。
- `package.json`：增加后台测试命令。

---

### Task 1: 建立发布目标安全决策

**Files:**
- Create: `functions/api/admin/_shared/services/publish-target.ts`
- Create: `tests/admin/publish-target.test.ts`

- [ ] **Step 1: 写失败测试，覆盖首次创建、未绑定冲突、绑定更新和 SHA 冲突**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { decidePublishTarget } from "../../functions/api/admin/_shared/services/publish-target";

test("首次发布只允许创建不存在的远端文件", () => {
	assert.deepEqual(decidePublishTarget(null, null), { mode: "create" });
});

test("未绑定草稿不能覆盖远端同路径文件", () => {
	assert.deepEqual(decidePublishTarget(null, "remote-sha"), {
		mode: "conflict",
		code: "content_path_occupied",
	});
});

test("已绑定且 SHA 一致时允许更新", () => {
	assert.deepEqual(decidePublishTarget("remote-sha", "remote-sha"), {
		mode: "update",
		sha: "remote-sha",
	});
});

test("已绑定文件缺失或 SHA 改变时拒绝更新", () => {
	assert.equal(decidePublishTarget("bound-sha", null).mode, "conflict");
	assert.equal(decidePublishTarget("bound-sha", "other-sha").mode, "conflict");
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `pnpm exec tsx --test tests/admin/publish-target.test.ts`

Expected: FAIL，提示无法解析 `publish-target`。

- [ ] **Step 3: 实现无副作用决策函数**

```ts
export type PublishTargetDecision =
	| { mode: "create" }
	| { mode: "update"; sha: string }
	| { mode: "conflict"; code: "content_path_occupied" | "content_remote_missing" | "content_remote_changed" };

export const decidePublishTarget = (
	boundSha: string | null,
	remoteSha: string | null,
): PublishTargetDecision => {
	if (!boundSha && !remoteSha) return { mode: "create" };
	if (!boundSha && remoteSha) return { mode: "conflict", code: "content_path_occupied" };
	if (boundSha && !remoteSha) return { mode: "conflict", code: "content_remote_missing" };
	if (boundSha !== remoteSha) return { mode: "conflict", code: "content_remote_changed" };
	return { mode: "update", sha: boundSha };
};
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `pnpm exec tsx --test tests/admin/publish-target.test.ts`

Expected: 4 tests PASS。

- [ ] **Step 5: 在现有发布端点先应用安全热修**

在 `functions/api/admin/drafts/[id]/publish.ts` 获取远端文件后调用 `decidePublishTarget()`；冲突返回 `409`，创建时不传 SHA，更新时只传绑定且匹配的 SHA。不得继续传递 `remote?.sha`。

- [ ] **Step 6: 重跑测试和 Astro 检查**

Run: `pnpm exec tsx --test tests/admin/publish-target.test.ts && pnpm check`

Expected: 测试全部通过，Astro diagnostics 无错误。

---

### Task 2: 添加内容版本和发布任务迁移

**Files:**
- Create: `migrations/0008_admin_publish_tasks.sql`
- Modify: `functions/api/admin/_shared/types.ts`

- [ ] **Step 1: 创建迁移，保留既有迁移不可变**

```sql
ALTER TABLE admin_drafts ADD COLUMN content_id TEXT;
ALTER TABLE admin_drafts ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE admin_drafts ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'local';

UPDATE admin_drafts SET content_id = id WHERE content_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_drafts_content_id
ON admin_drafts(content_id);

CREATE TABLE IF NOT EXISTS admin_publish_tasks (
	id TEXT PRIMARY KEY,
	idempotency_key TEXT NOT NULL UNIQUE,
	draft_id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	expected_version INTEGER NOT NULL,
	target_path TEXT NOT NULL,
	content_sha256 TEXT NOT NULL,
	status TEXT NOT NULL CHECK(status IN ('pending', 'publishing', 'github_committed', 'awaiting_deploy', 'published', 'validation_failed', 'content_conflict', 'submit_failed', 'reconciliation_required', 'build_failed', 'rolled_back')),
	attempts INTEGER NOT NULL DEFAULT 0,
	github_blob_sha TEXT,
	github_commit_sha TEXT,
	error_code TEXT,
	error_detail TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	completed_at TEXT,
	FOREIGN KEY(draft_id) REFERENCES admin_drafts(id),
	FOREIGN KEY(user_id) REFERENCES admin_users(id)
);

CREATE INDEX IF NOT EXISTS idx_admin_publish_tasks_status_updated
ON admin_publish_tasks(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_admin_publish_tasks_draft_created
ON admin_publish_tasks(draft_id, created_at DESC);
```

- [ ] **Step 2: 本地应用全部迁移**

Run: `pnpm admin:db:local`

Expected: `0008_admin_publish_tasks.sql` applied successfully。

- [ ] **Step 3: 重新运行迁移验证幂等记录**

Run: `pnpm admin:db:local`

Expected: No migrations to apply。

- [ ] **Step 4: 将 Row 类型明确命名并加入发布任务类型**

在 `types.ts` 中使用 `AdminUserRow`、`SessionRow`、`DraftRow`、`PublishTaskRow`，保持数据库字段 snake_case；更新现有 imports，不改变 API 字段。

- [ ] **Step 5: 运行后台测试和检查**

Run: `pnpm exec tsx --test tests/admin/*.test.ts && pnpm check`

Expected: 全部通过。

---

### Task 3: 建立统一 API 契约和安全包装器

**Files:**
- Create: `functions/api/admin/_shared/contracts.ts`
- Create: `functions/api/admin/_shared/errors.ts`
- Create: `functions/api/admin/_shared/handler.ts`
- Modify: `functions/api/admin/_shared/auth.ts`
- Modify: `functions/api/admin/_shared/audit.ts`

- [ ] **Step 1: 定义 camelCase DTO 和错误体**

```ts
export type ApiErrorBody = {
	code: string;
	message: string;
	fieldErrors?: Record<string, string>;
	retryable: boolean;
	requestId: string;
};

export type DraftSummaryDto = {
	id: string;
	contentId: string;
	slug: string;
	title: string;
	status: "draft" | "published";
	syncStatus: string;
	version: number;
	updatedAt: string;
};

export type PublishTaskStatus =
	| "pending"
	| "publishing"
	| "github_committed"
	| "awaiting_deploy"
	| "published"
	| "validation_failed"
	| "content_conflict"
	| "submit_failed"
	| "reconciliation_required"
	| "build_failed"
	| "rolled_back";
```

补全 `DraftDetailDto`、`DraftWriteDto`、`PublishRequestDto` 和 `PublishTaskDto`，字段使用 camelCase，且不包含密码、Token 或 SQL 错误。

- [ ] **Step 2: 实现 `ApiError`、成功响应和错误响应**

`errors.ts` 必须统一设置 `Content-Type: application/json` 与 `Cache-Control: no-store`，未知错误映射为 `internal_error`，不得返回原始异常文本。

- [ ] **Step 3: 实现四类 Handler 包装器**

```ts
adminGet(handler)
adminMutation(handler)
publicAdminMutation(handler)
bootstrapMutation(handler)
```

`adminGet` 执行 request ID、GET Origin 和认证；`adminMutation` 额外执行 CSRF；登录使用 `publicAdminMutation`；初始化使用 `bootstrapMutation`。包装器向业务函数传递 `{ requestId, session }`。

- [ ] **Step 4: 扩展审计参数**

审计记录加入 `requestId`、`resourceType`、`resourceId` 和 `result`；metadata 只允许 JSON 基础值并限制序列化长度。

- [ ] **Step 5: 迁移 session、csrf、login、logout 和 bootstrap 端点**

所有成功响应使用 `{ data, requestId }`，所有错误使用 `ApiErrorBody`。保持原 Session Cookie、Origin、CSRF、限速和 bootstrap 锁语义不变。

- [ ] **Step 6: 运行检查**

Run: `pnpm check && pnpm type-check`

Expected: 两个命令均成功。

---

### Task 4: 分离草稿 Repository、DTO 与列表详情

**Files:**
- Create: `functions/api/admin/_shared/repositories/draft-repository.ts`
- Create: `functions/api/admin/_shared/services/content-service.ts`
- Modify: `functions/api/admin/drafts/index.ts`
- Modify: `functions/api/admin/drafts/[id].ts`
- Modify: `functions/api/admin/_shared/db.ts`

- [ ] **Step 1: 使用显式列实现摘要查询**

```sql
SELECT id, content_id, slug, title, status, sync_status, version, updated_at
FROM admin_drafts
ORDER BY updated_at DESC
LIMIT ? OFFSET ?
```

Repository 不允许 `SELECT *`，详情查询显式列出正文和元数据。

- [ ] **Step 2: 实现 Row 到 DTO 的 Mapper**

`ContentService` 将 `ai_summary`、`source_link`、`github_sha` 等映射为 `aiSummary`、`sourceLink`、`githubSha`。列表 DTO 不包含 `content`。

- [ ] **Step 3: 将 GET 列表改为分页摘要**

支持 `page`、`pageSize`，默认 `1` 和 `20`，`pageSize` 上限 `100`。响应包含：

```ts
{
	items: DraftSummaryDto[];
	page: number;
	pageSize: number;
	total: number;
}
```

- [ ] **Step 4: 将 GET 详情、POST、PUT、DELETE 改为统一 DTO**

写入继续复用现有 `validateDraft()`；PUT 必须接收 `version` 并使用 `WHERE id = ? AND version = ?`，成功时 `version = version + 1`，冲突返回 `409 content_version_conflict`。

- [ ] **Step 5: 运行测试和检查**

Run: `pnpm exec tsx --test tests/admin/*.test.ts && pnpm check && pnpm type-check`

Expected: 全部通过。

---

### Task 5: 实现幂等发布任务和对账

**Files:**
- Create: `functions/api/admin/_shared/repositories/publish-task-repository.ts`
- Create: `functions/api/admin/_shared/services/publish-service.ts`
- Modify: `functions/api/admin/_shared/github.ts`
- Modify: `functions/api/admin/drafts/[id]/publish.ts`
- Create: `functions/api/admin/publish-tasks/[id].ts`
- Create: `functions/api/admin/publish-tasks/[id]/reconcile.ts`

- [ ] **Step 1: 分离 GitHub 创建和更新调用**

```ts
createGitHubFile(config, path, content, message)
updateGitHubFile(config, path, content, expectedSha, message)
```

创建函数的请求体永远不包含 `sha`；更新函数必须收到非空 `expectedSha`。两者继续使用路径白名单。

- [ ] **Step 2: 实现发布任务 Repository**

Repository 提供按幂等键查询、创建、从 `pending` 抢占到 `publishing`、记录 GitHub commit、标记待对账、完成和失败。所有状态更新使用 `WHERE id = ? AND status = ?`。

- [ ] **Step 3: 实现 PublishService**

执行顺序：

```text
校验 draft/version/markdown/path
→ 按 idempotencyKey 返回已有任务或创建任务
→ 原子抢占任务
→ 读取远端文件
→ decidePublishTarget
→ create 或 update GitHub
→ 记录 github_committed
→ 条件更新草稿绑定
→ 标记 awaiting_deploy
```

GitHub 成功后任何 D1 更新失败都调用 `markReconciliationRequired()`；不得返回 `submit_failed`。错误详情只保存受控错误代码。

- [ ] **Step 4: 修改发布请求契约**

前端请求必须提供：

```ts
{
	idempotencyKey: string;
	expectedVersion: number;
}
```

服务端忽略前端提供的路径和 GitHub SHA。响应返回 `PublishTaskDto`。

- [ ] **Step 5: 实现任务查询与对账接口**

GET `/api/admin/publish-tasks/:id` 返回当前状态。POST `/reconcile` 仅处理 `reconciliation_required`：读取远端 SHA/commit 证据，校验内容摘要后恢复草稿绑定并转为 `awaiting_deploy`；证据不匹配时保持原状态并返回不可重试冲突。

- [ ] **Step 6: 增加发布服务测试替身**

使用内存 Draft Repository、PublishTask Repository 和 GitHub Gateway 覆盖：重复幂等键不重复写 GitHub、未绑定路径存在时不写 GitHub、SHA 改变时不写 GitHub、GitHub 成功后 D1 失败进入 `reconciliation_required`。

- [ ] **Step 7: 运行后台测试与本地迁移**

Run: `pnpm exec tsx --test tests/admin/*.test.ts && pnpm admin:db:local`

Expected: 全部测试通过，无待应用迁移。

---

### Task 6: 建立前端 API Client 和 URL 路由

**Files:**
- Create: `src/components/admin/admin-types.ts`
- Create: `src/components/admin/admin-api.ts`
- Create: `src/components/admin/admin-router.ts`
- Create: `tests/admin/admin-router.test.ts`
- Modify: `package.json`

- [ ] **Step 1: 为 URL 解析写失败测试**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { formatAdminUrl, parseAdminRoute } from "../../src/components/admin/admin-router";

test("解析文章深链接", () => {
	assert.deepEqual(parseAdminRoute("http://localhost/admin/?view=posts&id=draft-1"), {
		view: "posts",
		resourceId: "draft-1",
	});
});

test("未知视图回退仪表盘", () => {
	assert.deepEqual(parseAdminRoute("http://localhost/admin/?view=unknown"), {
		view: "dashboard",
		resourceId: null,
	});
});

test("格式化路由时编码资源 ID", () => {
	assert.equal(formatAdminUrl({ view: "posts", resourceId: "a b" }), "/admin/?view=posts&id=a+b");
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm exec tsx --test tests/admin/admin-router.test.ts`

Expected: FAIL，提示模块不存在。

- [ ] **Step 3: 实现路由纯函数和浏览器导航函数**

支持 `dashboard`、`posts`、`media`、`pages`、`settings`、`publishing`、`security`。浏览器函数使用 `history.pushState()`、`replaceState()` 和 `popstate`。

- [ ] **Step 4: 实现统一 API Client**

`adminRequest<T>()` 自动附加 CSRF；解析统一错误体并保留 `status`、`code`、`fieldErrors`、`retryable`、`requestId`。遇到 `401` 时跳转 `/admin/login/?returnTo=<当前后台地址>`，不得把凭据写入 localStorage。

- [ ] **Step 5: 增加测试脚本**

在 `package.json` 增加：

```json
"test:admin": "tsx --test tests/admin/*.test.ts"
```

- [ ] **Step 6: 运行测试和类型检查**

Run: `pnpm test:admin && pnpm type-check`

Expected: 全部通过。

---

### Task 7: 拆分后台骨架与文章视图

**Files:**
- Create: `src/components/admin/AdminShell.svelte`
- Create: `src/components/admin/LoginView.svelte`
- Create: `src/components/admin/DashboardView.svelte`
- Create: `src/components/admin/PostListView.svelte`
- Create: `src/components/admin/PostEditorView.svelte`
- Modify: `src/components/admin/AdminApp.svelte`
- Modify: `src/pages/admin/index.astro`
- Modify: `src/pages/admin/login.astro`
- Modify: `src/styles/admin.css`

- [ ] **Step 1: 提取 LoginView**

组件接收 `submitting` 和 `error`，通过回调提交用户名和密码。登录成功后读取 `returnTo`，仅允许以 `/admin/` 开头的同源相对地址，其他值回退 `/admin/`。

- [ ] **Step 2: 提取 AdminShell**

保留现有 `admin-` class、桌面侧栏、移动抽屉、深色模式和 reduced-motion。导航由 `AdminRoute.view` 驱动，不维护第二份 `activeSection`。

- [ ] **Step 3: 提取 DashboardView 和 PostListView**

列表只接收 `DraftSummary[]`，选择文章时导航到 `?view=posts&id=<id>`；不依赖正文。

- [ ] **Step 4: 提取 PostEditorView**

进入文章深链接后调用详情 API。保存携带 `version`；`409 content_version_conflict` 显示重新加载提示。发布生成客户端随机幂等键，展示任务状态并轮询 GET 任务接口。

- [ ] **Step 5: 将 AdminApp 降为装配层**

只保留 Session 启动、路由订阅、当前资源加载、顶层通知和视图组合。媒体模块可以暂时保留为现有视图，但不得继续把文章发布逻辑写回 AdminApp。

- [ ] **Step 6: 补充发布状态视觉**

在 `admin.css` 增加 `pending`、`publishing`、`awaiting_deploy`、`reconciliation_required`、`content_conflict` 状态样式，沿用现有颜色变量和 `admin-` 前缀。

- [ ] **Step 7: 运行前端验证**

Run: `pnpm check && pnpm type-check && pnpm lint`

Expected: 全部命令成功，Biome 不产生无关格式化改动。

---

### Task 8: 端到端验证阶段一

**Files:**
- Modify only if verification exposes defects in files from Tasks 1-7.

- [ ] **Step 1: 从空本地状态验证迁移链**

将现有 `.wrangler/state` 临时备份到仓库外，运行：

Run: `pnpm admin:db:local`

Expected: `0001`、`0003` 至 `0008` 全部成功，空管理员表不触发 NOT NULL 错误。

- [ ] **Step 2: 运行后台测试**

Run: `pnpm test:admin`

Expected: 发布目标、发布幂等、对账和路由测试全部通过。

- [ ] **Step 3: 运行项目检查**

Run: `pnpm check && pnpm type-check && pnpm lint && pnpm build`

Expected: 四个命令全部以 exit code 0 完成。

- [ ] **Step 4: 启动本地 Pages 环境**

Run: `pnpm admin:dev`

Expected: Wrangler 在 `http://127.0.0.1:8788` 启动，D1 和 R2 bindings 可用；浏览器 Origin 与 `ALLOWED_ORIGIN` 完全一致。

- [ ] **Step 5: 验证安全发布场景**

依次验证：

1. 未登录读取草稿返回统一 `401`。
2. 缺少 CSRF 的写请求返回统一 `403`。
3. 新草稿目标路径在 GitHub 已存在时返回 `409 content_path_occupied`，远端文件不变。
4. 已绑定 SHA 与远端不一致时返回 `409 content_remote_changed`。
5. 相同幂等键重复提交只产生一个 GitHub commit。
6. 模拟 GitHub 成功后 D1 条件更新失败，任务变为 `reconciliation_required`。
7. 调用 reconcile 后恢复到 `awaiting_deploy`。

- [ ] **Step 6: 验证后台体验**

验证登录回跳、文章深链接刷新、浏览器前进后退、移动抽屉、深色模式、Session 过期跳转、编辑冲突提示和发布状态显示。

- [ ] **Step 7: 恢复原本地 D1 状态并确认无临时文件进入项目**

不得删除用户原状态；恢复备份后检查项目目录中不存在测试数据库副本、Token、账号密码或日志。

## 完成门槛

- 首次发布无法覆盖未绑定 GitHub 文件。
- GitHub 与 D1 部分成功被记录为可对账任务。
- 草稿列表不再返回正文，保存具有版本冲突保护。
- API 使用统一错误契约和 request ID。
- 后台刷新与前进后退不丢失当前模块或文章。
- `pnpm test:admin`、`pnpm check`、`pnpm type-check`、`pnpm lint`、`pnpm build` 全部通过。
- 阶段一完成后才能开始“完整文章管理”计划。
