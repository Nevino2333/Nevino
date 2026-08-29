<script lang="ts">
import { onMount } from "svelte";
import { adminRequest } from "./admin-api";
import type { ContentOperationRow, PublishTaskRow } from "./admin-types";
import { canReconcilePublishTask } from "./editor-state";

type Props = {
	onnotice?: (message: string) => void;
	onerror?: (message: string) => void;
	onopenpost?: (draftId: string) => void;
};

let { onnotice = () => {}, onerror = () => {}, onopenpost }: Props = $props();

let tab = $state<"tasks" | "operations">("tasks");
let tasks = $state<PublishTaskRow[]>([]);
let operations = $state<ContentOperationRow[]>([]);
let loading = $state(true);
let triggering = $state(false);
let reconcilingId = $state<string | null>(null);

const taskStatusLabels: Record<string, string> = {
	pending: "待发布",
	publishing: "发布中",
	github_committed: "GitHub 已提交",
	awaiting_deploy: "等待部署",
	published: "已上线",
	validation_failed: "校验失败",
	content_conflict: "内容冲突",
	submit_failed: "提交失败",
	reconciliation_required: "待对账",
	build_failed: "构建失败",
	rolled_back: "已回滚",
};

const operationLabels: Record<string, string> = {
	import: "导入",
	rename: "改名",
	withdraw: "撤回",
	delete: "删除",
	rollback: "回滚",
};

const operationStatusLabels: Record<string, string> = {
	pending: "进行中",
	github_committed: "GitHub 已提交",
	completed: "已完成",
	reconciliation_required: "待对账",
	failed: "失败",
};

async function load() {
	loading = true;
	try {
		const [taskResult, operationResult] = await Promise.all([
			adminRequest<{ items: PublishTaskRow[] }>("/publish-tasks?limit=50"),
			adminRequest<{ items: ContentOperationRow[] }>(
				"/content-operations?limit=50",
			),
		]);
		tasks = taskResult.items;
		operations = operationResult.items;
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "发布记录加载失败");
	} finally {
		loading = false;
	}
}

async function triggerBuild() {
	if (!confirm("触发一次 Cloudflare Pages 重新构建？")) return;
	triggering = true;
	try {
		await adminRequest("/deployments/trigger", { method: "POST" });
		onnotice("已触发重新构建，稍后可在发布任务中查看结果");
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "触发失败");
	} finally {
		triggering = false;
	}
}

async function reconcileTask(id: string) {
	reconcilingId = id;
	try {
		await adminRequest(`/publish-tasks/${encodeURIComponent(id)}/reconcile`, {
			method: "POST",
		});
		onnotice("发布任务已对账恢复，等待部署完成");
		await load();
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "发布对账失败");
	} finally {
		reconcilingId = null;
	}
}

function formatTime(value: string): string {
	return value ? value.replace("T", " ").slice(0, 19) : "";
}

onMount(() => {
	void load();
});
</script>

<section class="admin-view">
	<div class="admin-view-heading">
		<div>
			<p class="admin-kicker">PUBLISHING</p>
			<h2>发布中心</h2>
			<p>跟踪发布任务、内容操作与部署状态。</p>
		</div>
		<div class="admin-heading-actions">
			<button class="admin-button admin-button-ghost" onclick={load}>刷新</button>
			<button class="admin-button" disabled={triggering} onclick={triggerBuild}>{triggering ? "触发中…" : "重新构建站点"}</button>
		</div>
	</div>

	<div class="admin-page-tabs">
		<button class:active={tab === "tasks"} onclick={() => tab = "tasks"}>发布任务</button>
		<button class:active={tab === "operations"} onclick={() => tab = "operations"}>内容操作</button>
	</div>

	{#if loading}
		<div class="admin-panel admin-state"><span class="admin-spinner"></span><p>正在加载…</p></div>
	{:else if tab === "tasks"}
		{#if tasks.length === 0}
			<div class="admin-panel admin-state admin-state-large"><span class="admin-state-icon">⇧</span><h3>暂无发布任务</h3><p>在文章编辑器里发起发布会在这里生成可追踪的任务。</p></div>
		{:else}
			<div class="admin-table-wrap">
				<table class="admin-table">
					<thead><tr><th>状态</th><th>文章</th><th>提交</th><th>创建时间</th><th>更新时间</th><th>操作</th></tr></thead>
					<tbody>
						{#each tasks as row (row.id)}
							<tr class:alert={row.status === "reconciliation_required" || row.status === "build_failed" || row.status === "submit_failed"}>
								<td><span class="admin-status-pill admin-status-{row.status}">{taskStatusLabels[row.status] ?? row.status}</span>{#if row.error_code}<small class="admin-muted">{row.error_code}</small>{/if}</td>
								<td>{#if onopenpost}<button class="admin-link-button" onclick={() => onopenpost(row.draft_id)}>{row.draft_id}</button>{:else}{row.draft_id}{/if}</td>
								<td><code>{row.github_commit_sha ? row.github_commit_sha.slice(0, 7) : "—"}</code></td>
								<td>{formatTime(row.created_at)}</td>
								<td>{formatTime(row.updated_at)}</td>
								<td>{#if canReconcilePublishTask(row.status)}<button class="admin-link-button" disabled={reconcilingId === row.id} onclick={() => reconcileTask(row.id)}>{reconcilingId === row.id ? "对账中…" : "重新对账"}</button>{:else}<span class="admin-muted">—</span>{/if}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{:else}
		{#if operations.length === 0}
			<div class="admin-panel admin-state admin-state-large"><span class="admin-state-icon">≡</span><h3>暂无内容操作</h3><p>导入、改名、撤回、删除与回滚记录会出现在这里。</p></div>
		{:else}
			<div class="admin-table-wrap">
				<table class="admin-table">
					<thead><tr><th>操作</th><th>状态</th><th>路径</th><th>提交</th><th>时间</th></tr></thead>
					<tbody>
						{#each operations as row (row.id)}
							<tr class:alert={row.status === "reconciliation_required" || row.status === "failed"}>
								<td><span class="admin-status-pill">{operationLabels[row.type] ?? row.type}</span></td>
								<td><span class="admin-status-pill admin-status-{row.status}">{operationStatusLabels[row.status] ?? row.status}</span>{#if row.error_code}<small class="admin-muted">{row.error_code}</small>{/if}</td>
								<td><code class="admin-path-cell">{row.target_path ?? row.source_path ?? "—"}</code></td>
								<td><code>{row.commit_sha ? row.commit_sha.slice(0, 7) : "—"}</code></td>
								<td>{formatTime(row.updated_at)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</section>
