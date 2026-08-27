<script lang="ts">
import type { AdminView, DraftSummary } from "./admin-types";

type Props = {
	drafts: DraftSummary[];
	loading: boolean;
	mediaCount: number | null;
	mediaUnavailable: boolean;
	onnavigate: (view: AdminView) => void;
	onopenpost: (id: string | null) => void;
};

let {
	drafts,
	loading,
	mediaCount,
	mediaUnavailable,
	onnavigate,
	onopenpost,
}: Props = $props();
const draftCount = $derived(
	drafts.filter((draft) => draft.status !== "published").length,
);
const publishedCount = $derived(
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
</script>

<section class="admin-view">
	<div class="admin-welcome"><div><p class="admin-kicker">OVERVIEW</p><h2>欢迎回来，继续记录今天。</h2><p>这里汇总了写作与媒体状态，让每次更新都有清晰的起点。</p></div><button class="admin-button admin-button-primary" onclick={() => onopenpost(null)}>开始写作</button></div>
	<div class="admin-stats">
		<article><span class="admin-stat-icon">✎</span><div><small>草稿</small><strong>{loading ? "—" : draftCount}</strong><p>等待继续完善</p></div></article>
		<article><span class="admin-stat-icon admin-stat-green">✓</span><div><small>已发布</small><strong>{loading ? "—" : publishedCount}</strong><p>来自后台记录</p></div></article>
		<article><span class="admin-stat-icon admin-stat-gold">▧</span><div><small>媒体</small><strong>{mediaCount ?? "—"}</strong><p>{mediaUnavailable ? "R2 尚未配置" : mediaCount === null ? "进入媒体库加载" : "可用图片资源"}</p></div></article>
		<article><span class="admin-stat-icon admin-stat-purple">◷</span><div><small>最近保存</small><strong class="admin-stat-time">{latestSaved ? formatDate(latestSaved, true) : "暂无"}</strong><p>最新编辑记录</p></div></article>
	</div>
	<div class="admin-dashboard-grid">
		<section class="admin-panel admin-recent"><div class="admin-card-head"><div><p class="admin-kicker">RECENT POSTS</p><h3>最近文章</h3></div><button onclick={() => onnavigate("posts")}>查看全部 →</button></div>
			{#if loading}<div class="admin-state"><span class="admin-spinner"></span><p>正在加载文章…</p></div>{:else if drafts.length === 0}<div class="admin-state"><span class="admin-state-icon">✎</span><h4>还没有文章</h4><p>新建第一篇草稿，开始你的写作记录。</p><button class="admin-button admin-button-primary" onclick={() => onopenpost(null)}>新建文章</button></div>{:else}<div class="admin-recent-list">{#each drafts.slice(0, 5) as draft}<button onclick={() => onopenpost(draft.id)}><span class="admin-post-symbol">{draft.status === "published" ? "✓" : "✎"}</span><span><strong>{draft.title || "无标题"}</strong><small>{formatDate(draft.updatedAt, true)}</small></span><em class:published={draft.status === "published"}>{draft.status === "published" ? "已发布" : "草稿"}</em></button>{/each}</div>{/if}
		</section>
		<aside class="admin-panel admin-quick"><div class="admin-card-head"><div><p class="admin-kicker">QUICK ACTIONS</p><h3>快捷操作</h3></div></div><button onclick={() => onopenpost(null)}><span>＋</span><div><strong>新建文章</strong><small>创建一篇新的 Markdown 草稿</small></div></button><button onclick={() => onnavigate("media")}><span>⇧</span><div><strong>上传图片</strong><small>添加图片到媒体库</small></div></button><button onclick={() => onnavigate("settings")}><span>⚙</span><div><strong>站点设置</strong><small>查看当前后台配置</small></div></button></aside>
	</div>
</section>
