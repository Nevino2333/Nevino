<script lang="ts">
import { onMount } from "svelte";
import { adminRequest } from "./admin-api";
import type { AdminOverview, AdminView, DraftSummary } from "./admin-types";

type Props = {
	drafts: DraftSummary[];
	loading: boolean;
	onnavigate: (view: AdminView) => void;
	onopenpost: (id: string | null) => void;
	onerror?: (message: string) => void;
};

let {
	drafts,
	loading,
	onnavigate,
	onopenpost,
	onerror = () => {},
}: Props = $props();

let overview = $state<AdminOverview | null>(null);
let overviewLoading = $state(true);

async function loadOverview() {
	overviewLoading = true;
	try {
		overview = await adminRequest<AdminOverview>("/overview");
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "概览加载失败");
	} finally {
		overviewLoading = false;
	}
}

const draftCount = $derived(
	overview?.posts.drafts ??
		drafts.filter((draft) => draft.status !== "published").length,
);
const publishedCount = $derived(
	overview?.posts.published ??
		drafts.filter((draft) => draft.status === "published").length,
);
const latestSaved = $derived(drafts[0]?.updatedAt || "");

function formatDate(value: string, includeTime = false) {
	if (!value) return "暂无记录";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat(
		"zh-CN",
		includeTime
			? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
			: { year: "numeric", month: "short", day: "numeric" },
	).format(date);
}

const formatFull = (value: string | null): string =>
	value ? value.replace("T", " ").slice(0, 19) : "暂无记录";

const pendingChanges = $derived(
	(overview?.settings.stagedGroups ?? 0) + (overview?.pages.staged ?? 0),
);

onMount(() => {
	void loadOverview();
});
</script>

<section class="admin-view">
	<div class="admin-welcome"><div><p class="admin-kicker">OVERVIEW</p><h2>欢迎回来，继续记录今天。</h2><p>这里汇总了写作、内容与发布状态，让每次更新都有清晰的起点。</p></div><button class="admin-button admin-button-primary" onclick={() => onopenpost(null)}>开始写作</button></div>
	<div class="admin-stats">
		<article><span class="admin-stat-icon">✎</span><div><small>草稿</small><strong>{overviewLoading ? "—" : draftCount}</strong><p>等待继续完善</p></div></article>
		<article><span class="admin-stat-icon admin-stat-green">✓</span><div><small>已发布</small><strong>{overviewLoading ? "—" : publishedCount}</strong><p>线上文章记录</p></div></article>
		<article><span class="admin-stat-icon admin-stat-gold">▧</span><div><small>媒体</small><strong>{overviewLoading ? "—" : overview?.mediaCount ?? "—"}</strong><p>{overview && !overview.mediaAvailable ? "R2 尚未配置" : "可用图片资源"}</p></div></article>
		<article><span class="admin-stat-icon admin-stat-purple">◷</span><div><small>最近保存</small><strong class="admin-stat-time">{latestSaved ? formatDate(latestSaved, true) : "暂无"}</strong><p>最新编辑记录</p></div></article>
	</div>

	{#if overview && (pendingChanges > 0 || overview.publishing.reconciliationRequired > 0 || overview.publishing.failedOperations > 0)}
		<div class="admin-alert admin-notice admin-dashboard-attention" role="status">
			<span>!</span>
			<div>
				{#if pendingChanges > 0}<p>{pendingChanges} 项内容/设置修改待发布（<button class="admin-link-button" onclick={() => onnavigate("settings")}>站点设置</button> / <button class="admin-link-button" onclick={() => onnavigate("pages")}>页面</button>）。</p>{/if}
				{#if overview.publishing.reconciliationRequired > 0}<p>{overview.publishing.reconciliationRequired} 个发布任务待对账，前往 <button class="admin-link-button" onclick={() => onnavigate("publishing")}>发布中心</button> 处理。</p>{/if}
				{#if overview.publishing.failedOperations > 0}<p>{overview.publishing.failedOperations} 个内容操作需要关注，前往 <button class="admin-link-button" onclick={() => onnavigate("publishing")}>发布中心</button> 查看。</p>{/if}
			</div>
		</div>
	{/if}

	<div class="admin-dashboard-grid">
		<section class="admin-panel admin-recent"><div class="admin-card-head"><div><p class="admin-kicker">RECENT POSTS</p><h3>最近文章</h3></div><button onclick={() => onnavigate("posts")}>查看全部 →</button></div>
			{#if loading}<div class="admin-state"><span class="admin-spinner"></span><p>正在加载文章…</p></div>{:else if drafts.length === 0}<div class="admin-state"><span class="admin-state-icon">✎</span><h4>还没有文章</h4><p>新建第一篇草稿，开始你的写作记录。</p><button class="admin-button admin-button-primary" onclick={() => onopenpost(null)}>新建文章</button></div>{:else}<div class="admin-recent-list">{#each drafts.slice(0, 5) as draft}<button onclick={() => onopenpost(draft.id)}><span class="admin-post-symbol">{draft.status === "published" ? "✓" : "✎"}</span><span><strong>{draft.title || "无标题"}</strong><small>{formatDate(draft.updatedAt, true)}</small></span><em class:published={draft.status === "published"}>{draft.status === "published" ? "已发布" : "草稿"}</em></button>{/each}</div>{/if}
		</section>
		<aside class="admin-panel admin-quick">
			<div class="admin-card-head"><div><p class="admin-kicker">QUICK ACTIONS</p><h3>快捷操作</h3></div></div>
			<button onclick={() => onopenpost(null)}><span>＋</span><div><strong>新建文章</strong><small>创建一篇新的 Markdown 草稿</small></div></button>
			<button onclick={() => onnavigate("media")}><span>⇧</span><div><strong>上传图片</strong><small>添加图片到媒体库</small></div></button>
			<button onclick={() => onnavigate("settings")}><span>⚙</span><div><strong>站点设置</strong><small>修改站点信息与集成配置</small></div></button>
			<button onclick={() => onnavigate("friends")}><span>❐</span><div><strong>友链管理</strong><small>维护友链列表与朋友圈来源</small></div></button>
			<button onclick={() => onnavigate("publishing")}><span>⇨</span><div><strong>发布中心</strong><small>查看发布任务与部署状态</small></div></button>
		</aside>
	</div>

	<div class="admin-dashboard-grid admin-dashboard-secondary">
		<section class="admin-panel">
			<div class="admin-card-head"><div><p class="admin-kicker">DEPLOYMENT</p><h3>发布状态</h3></div><button onclick={() => onnavigate("publishing")}>发布中心 →</button></div>
			<ul class="admin-overview-list">
				<li><span>活动发布任务</span><strong>{overviewLoading ? "—" : overview?.publishing.activeTasks ?? "—"}</strong></li>
				<li><span>待对账任务</span><strong class={overview && overview.publishing.reconciliationRequired > 0 ? "admin-warning-text" : ""}>{overviewLoading ? "—" : overview?.publishing.reconciliationRequired ?? "—"}</strong></li>
				<li><span>最近部署</span><strong class="admin-stat-time">{overviewLoading ? "—" : formatFull(overview?.publishing.lastDeployedAt ?? null)}</strong></li>
				<li><span>GitHub 集成</span><strong>{overviewLoading ? "—" : overview?.githubConfigured ? "已连接" : "未配置"}</strong></li>
			</ul>
		</section>
		<section class="admin-panel">
			<div class="admin-card-head"><div><p class="admin-kicker">AUDIT</p><h3>最近操作</h3></div><button onclick={() => onnavigate("security")}>审计日志 →</button></div>
			<ul class="admin-overview-list admin-audit-brief">
				{#if overviewLoading}
					<li><span>加载中…</span></li>
				{:else if (overview?.recentAudit ?? []).length === 0}
					<li><span>暂无审计记录</span></li>
				{:else}
					{#each overview?.recentAudit ?? [] as item (item.id)}
						<li><span><code>{item.action}</code> {item.resourceType}{item.resourceId ? " · " + item.resourceId : ""}</span><small class="admin-muted">{formatFull(item.createdAt)}</small></li>
					{/each}
				{/if}
			</ul>
		</section>
	</div>
</section>
