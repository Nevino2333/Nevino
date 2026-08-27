<script lang="ts">
import type { AdminRoute, AdminView } from "./admin-types";

type Props = {
	route: AdminRoute;
	error: string;
	notice: string;
	onnavigate: (view: AdminView, resourceId?: string | null) => void;
	onnewpost: () => void;
	onlogout: () => void;
	onclearerror: () => void;
	onclearnotice: () => void;
	children: import("svelte").Snippet;
};

let {
	route,
	error,
	notice,
	onnavigate,
	onnewpost,
	onlogout,
	onclearerror,
	onclearnotice,
	children,
}: Props = $props();
let drawerOpen = $state(false);

const navigation: { id: AdminView; label: string; icon: string }[] = [
	{ id: "dashboard", label: "仪表盘", icon: "⌂" },
	{ id: "posts", label: "文章", icon: "✎" },
	{ id: "media", label: "媒体库", icon: "▧" },
	{ id: "pages", label: "页面", icon: "▤" },
	{ id: "settings", label: "设置", icon: "⚙" },
	{ id: "publishing", label: "发布", icon: "⇧" },
	{ id: "security", label: "安全", icon: "◇" },
];
const sectionTitle = $derived(
	navigation.find((item) => item.id === route.view)?.label || "后台",
);

function navigate(view: AdminView) {
	drawerOpen = false;
	onnavigate(view, null);
}
</script>

<main class="admin-shell admin-app-shell">
	<button class:open={drawerOpen} class="admin-drawer-backdrop" aria-label="关闭导航" onclick={() => drawerOpen = false}></button>
	<aside class:open={drawerOpen} class="admin-app-nav">
		<a class="admin-app-brand" href="/"><span class="admin-brand-mark">N</span><span><strong>Nevino's blog</strong><small>写作后台</small></span></a>
		<nav aria-label="后台导航">
			{#each navigation as item}
				<button class:active={route.view === item.id} onclick={() => navigate(item.id)}><span aria-hidden="true">{item.icon}</span>{item.label}</button>
			{/each}
		</nav>
		<div class="admin-nav-foot"><span class="admin-session-status"><span class="admin-status-dot"></span>安全会话已连接</span><a href="/">查看博客 <span aria-hidden="true">↗</span></a><button onclick={onlogout}>退出登录</button></div>
	</aside>
	<div class="admin-app-main">
		<header class="admin-topbar">
			<div class="admin-topbar-title"><button class="admin-menu-button" aria-label="打开导航" aria-expanded={drawerOpen} onclick={() => drawerOpen = !drawerOpen}>☰</button><div><p class="admin-kicker">FIREFLY / ADMIN</p><h1>{sectionTitle}</h1></div></div>
			<div class="admin-topbar-actions"><button class="admin-button admin-button-ghost" onclick={onnewpost}>＋ 新建文章</button><span class="admin-avatar"><img src="/assets/Avater.png" alt="管理员" /></span></div>
		</header>
		<div class="admin-mobile-tabs" aria-label="后台区域">
			{#each navigation.slice(0, 3) as item}<button class:active={route.view === item.id} onclick={() => navigate(item.id)}>{item.label}</button>{/each}
		</div>
		{#if error}<div class="admin-alert admin-error" role="alert"><span>!</span>{error}<button aria-label="关闭" onclick={onclearerror}>×</button></div>{/if}
		{#if notice}<div class="admin-alert admin-notice" role="status"><span>✓</span>{notice}<button aria-label="关闭" onclick={onclearnotice}>×</button></div>{/if}
		{@render children()}
	</div>
</main>
