<script lang="ts">
import { onDestroy } from "svelte";
import type { DraftSummary, PostFilterState } from "./admin-types";
import { draftPageCount } from "./pagination";

type Props = {
	drafts: DraftSummary[];
	selectedId: string | null;
	loading: boolean;
	page: number;
	pageSize: number;
	total: number;
	filters: PostFilterState;
	onselect: (id: string | null) => void;
	onfilters: (filters: PostFilterState) => void;
	onimport: () => void;
};

let {
	drafts,
	selectedId,
	loading,
	page,
	pageSize,
	total,
	filters,
	onselect,
	onfilters,
	onimport,
}: Props = $props();
let pageCount = $derived(draftPageCount(total, pageSize));
let searchValue = $state(filters.query);
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let hasFilters = $derived(
	Boolean(filters.query) ||
		filters.publicationState !== "all" ||
		filters.workspaceState !== "all" ||
		filters.syncStatus !== "all" ||
		Boolean(filters.tag) ||
		Boolean(filters.category),
);

function formatDate(value: string) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat("zh-CN", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(date);
}

function updateFilter<Key extends keyof PostFilterState>(
	key: Key,
	value: PostFilterState[Key],
) {
	onfilters({ ...filters, [key]: value, page: 1 });
}

function updateSearch(value: string) {
	searchValue = value;
	if (searchTimer) clearTimeout(searchTimer);
	searchTimer = setTimeout(() => updateFilter("query", value), 300);
}

function clearFilters() {
	searchValue = "";
	if (searchTimer) clearTimeout(searchTimer);
	onfilters({
		query: "",
		publicationState: "all",
		workspaceState: "all",
		syncStatus: "all",
		tag: "",
		category: "",
		page: 1,
	});
}

function statusLabel(draft: DraftSummary) {
	if (draft.status === "build_failed") return "构建失败";
	if (draft.publicationState === "withdrawn") return "已撤回";
	if (draft.publicationState === "published") return "已发布";
	return "草稿";
}

onDestroy(() => {
	if (searchTimer) clearTimeout(searchTimer);
});
</script>

<aside class="admin-post-list admin-panel">
	<div class="admin-card-head"><div><p class="admin-kicker">ALL POSTS</p><h3>文章列表</h3></div><div class="admin-list-actions"><button class="admin-button admin-button-small" onclick={onimport}>导入</button><button class="admin-button admin-button-small" onclick={() => onselect(null)}>新建</button></div></div>
	<div class="admin-post-filters">
		<label><span>搜索</span><input type="search" value={searchValue} placeholder="标题或 slug" oninput={(event) => updateSearch(event.currentTarget.value)} /></label>
		<label><span>发布状态</span><select value={filters.publicationState} onchange={(event) => updateFilter("publicationState", event.currentTarget.value as PostFilterState["publicationState"])}><option value="all">全部</option><option value="draft">草稿</option><option value="published">已发布</option><option value="withdrawn">已撤回</option></select></label>
		<label><span>工作区</span><select value={filters.workspaceState} onchange={(event) => updateFilter("workspaceState", event.currentTarget.value as PostFilterState["workspaceState"])}><option value="all">全部</option><option value="clean">已同步</option><option value="modified">已修改</option></select></label>
		<label><span>同步状态</span><select value={filters.syncStatus} onchange={(event) => updateFilter("syncStatus", event.currentTarget.value as PostFilterState["syncStatus"])}><option value="all">全部</option><option value="local">本地</option><option value="publishing">发布中</option><option value="published">已发布</option><option value="modified">有修订</option><option value="reconciliation_required">待对账</option></select></label>
		<label><span>标签</span><input value={filters.tag} maxlength="100" oninput={(event) => updateFilter("tag", event.currentTarget.value)} /></label>
		<label><span>分类</span><input value={filters.category} maxlength="100" oninput={(event) => updateFilter("category", event.currentTarget.value)} /></label>
		{#if hasFilters}<button class="admin-button admin-button-small" onclick={clearFilters}>清除筛选</button>{/if}
	</div>
	{#if loading}<div class="admin-state admin-state-small"><span class="admin-spinner"></span><p>正在加载…</p></div>{:else if total === 0}<div class="admin-state admin-state-small"><span class="admin-state-icon">✎</span><h4>{hasFilters ? "没有匹配文章" : "暂无文章"}</h4><p>{hasFilters ? "请调整或清除当前筛选。" : "从一篇新草稿开始。"}</p></div>{:else}<nav aria-label="文章列表">{#each drafts as draft}<button class:active={draft.id === selectedId} class="admin-draft-item" onclick={() => onselect(draft.id)}><span><strong>{draft.title || "无标题"}</strong><em class:published={draft.publicationState === "published"}>{statusLabel(draft)}</em></span>{#if draft.syncStatus === "modified"}<small>有未发布修订</small>{/if}{#if draft.category}<small>{draft.category}</small>{/if}{#if draft.tags.length}<small>{draft.tags.join(" · ")}</small>{/if}<small>{formatDate(draft.updatedAt)}</small></button>{/each}</nav><div class="admin-list-pagination"><button disabled={page <= 1 || loading} onclick={() => onfilters({ ...filters, page: page - 1 })}>上一页</button><span>{page} / {pageCount} · 共 {total} 篇</span><button disabled={page >= pageCount || loading} onclick={() => onfilters({ ...filters, page: page + 1 })}>下一页</button></div>{/if}
</aside>
