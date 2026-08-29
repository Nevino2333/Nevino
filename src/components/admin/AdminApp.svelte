<script lang="ts">
import { onMount } from "svelte";
import AdminShell from "./AdminShell.svelte";
import { adminApi, adminRequest } from "./admin-api";
import {
	parseAdminRoute,
	pushAdminRoute,
	replaceAdminRoute,
	subscribeAdminRoute,
} from "./admin-router";
import type {
	AdminRoute,
	AdminView,
	DraftDetail,
	DraftPage,
	DraftSummary,
} from "./admin-types";
import DashboardView from "./DashboardView.svelte";
import {
	canLeaveEditor,
	canLogoutEditor,
	performLogout,
	shouldProtectBeforeUnload,
} from "./editor-state";
import LoginView from "./LoginView.svelte";
import MediaView from "./MediaView.svelte";
import PagesView from "./PagesView.svelte";
import PostEditorView from "./PostEditorView.svelte";
import PostImportDialog from "./PostImportDialog.svelte";
import PostListView from "./PostListView.svelte";
import PublishingView from "./PublishingView.svelte";
import { clampDraftPage } from "./pagination";
import { defaultPostFilters, postFilterQuery } from "./post-filters";
import SecurityView from "./SecurityView.svelte";
import SettingsView from "./SettingsView.svelte";
import StructuredConfigEditor from "./StructuredConfigEditor.svelte";

type Props = { initialView?: "login" | "app" };
let { initialView = "app" }: Props = $props();
let authenticated = $state(initialView === "app");
let loading = $state(true);
let loggingIn = $state(false);
let route = $state<AdminRoute>({
	view: "dashboard",
	resourceId: null,
	postFilters: defaultPostFilters,
});
let drafts = $state<DraftSummary[]>([]);
let draftPage = $state(1);
let draftPageSize = $state(20);
let draftTotal = $state(0);
let draftsLoading = $state(false);
let error = $state("");
let notice = $state("");
let mediaCount = $state<number | null>(null);
let mediaUnavailable = $state(false);
let mediaInsert = $state<{ value: string; key: number } | null>(null);
let mediaCover = $state<{ value: string; key: number } | null>(null);
let currentPostId = $state<string | null>(null);
let editorMounted = $state(false);
let editorDirty = $state(false);
let pagesDirty = $state(false);
let importDialogOpen = $state(false);
let skipNextRouteConfirmation = false;
let mediaKey = 0;

function safeReturnTo(): string {
	const value = new URL(window.location.href).searchParams.get("returnTo");
	if (!value?.startsWith("/admin/") || value.startsWith("//")) return "/admin/";
	try {
		const target = new URL(value, window.location.origin);
		return target.origin === window.location.origin
			? `${target.pathname}${target.search}${target.hash}`
			: "/admin/";
	} catch {
		return "/admin/";
	}
}

async function loadDrafts(filters = route.postFilters) {
	draftsLoading = true;
	try {
		const data = await adminRequest<DraftPage>(
			`/drafts?${postFilterQuery(filters, draftPageSize)}`,
		);
		drafts = data.items || [];
		draftTotal = data.total;
		draftPageSize = data.pageSize;
		draftPage = clampDraftPage(data.page, data.total, data.pageSize);
		if (draftPage !== data.page) {
			const nextFilters = { ...filters, page: draftPage };
			route = { ...route, postFilters: nextFilters };
			replaceAdminRoute(route);
			await loadDrafts(nextFilters);
		}
	} catch (cause) {
		error = cause instanceof Error ? cause.message : "文章加载失败";
	} finally {
		draftsLoading = false;
	}
}

async function loadSession() {
	try {
		const data = await adminRequest<{ authenticated: boolean }>("/session");
		authenticated = data.authenticated;
		if (authenticated) await loadDrafts();
	} catch {
		authenticated = false;
	} finally {
		loading = false;
	}
}

async function login(credentials: { username: string; password: string }) {
	loggingIn = true;
	error = "";
	try {
		await adminRequest("/login", {
			method: "POST",
			body: JSON.stringify(credentials),
		});
		adminApi.clearCsrf();
		window.location.assign(safeReturnTo());
	} catch (cause) {
		error = cause instanceof Error ? cause.message : "登录失败";
	} finally {
		loggingIn = false;
	}
}

async function logout() {
	if (
		!canLogoutEditor(editorDirty, () =>
			window.confirm("当前文章有未保存更改，确定要退出登录吗？"),
		)
	)
		return;
	error = "";
	try {
		await performLogout(
			() => adminRequest("/logout", { method: "POST", body: "{}" }),
			() => adminApi.clearCsrf(),
			() => window.location.assign("/admin/login/"),
		);
	} catch (cause) {
		error = cause instanceof Error ? cause.message : "退出登录失败";
	}
}

function changesEditor(nextRoute: AdminRoute): boolean {
	if (route.view === "posts")
		return (
			nextRoute.view !== "posts" || nextRoute.resourceId !== route.resourceId
		);
	if (route.view === "pages") return nextRoute.view !== "pages" && pagesDirty;
	return false;
}

function confirmNavigation(nextRoute: AdminRoute): boolean {
	if (!changesEditor(nextRoute)) return true;
	if (route.view === "pages")
		return window.confirm("页面有未保存修改，确定要离开吗？");
	return canLeaveEditor(editorDirty, () =>
		window.confirm("当前文章有未保存更改，确定要离开吗？"),
	);
}

function navigate(view: AdminView, resourceId: string | null = null) {
	const nextRoute = { view, resourceId, postFilters: route.postFilters };
	if (!confirmNavigation(nextRoute)) return;
	error = "";
	notice = "";
	if (view === "posts") {
		currentPostId = resourceId;
		editorMounted = true;
	}
	if (route.view === "pages" && nextRoute.view !== "pages") pagesDirty = false;
	skipNextRouteConfirmation = true;
	pushAdminRoute(nextRoute);
}

function updatePostFilters(postFilters: AdminRoute["postFilters"]) {
	route = { ...route, postFilters };
	replaceAdminRoute(route);
	void loadDrafts(postFilters);
}

function updateDraft(value: DraftDetail) {
	const summary: DraftSummary = value;
	const index = drafts.findIndex((draft) => draft.id === value.id);
	if (index >= 0) drafts[index] = summary;
	void loadDrafts(route.postFilters);
}

function deleteDraft() {
	navigate("posts", null);
	void loadDrafts(route.postFilters);
}

function importDraft(value: DraftDetail) {
	importDialogOpen = false;
	void loadDrafts(route.postFilters);
	navigate("posts", value.id);
	notice = "文章已导入后台";
}

function insertMedia(value: string) {
	mediaInsert = { value, key: ++mediaKey };
	navigate("posts", currentPostId);
	notice = "已插入图片 Markdown，返回文章继续编辑。";
}

function setCover(value: string) {
	mediaCover = { value, key: ++mediaKey };
	navigate("posts", currentPostId);
	notice = "已设置当前文章封面，返回文章继续编辑。";
}

onMount(() => {
	route = parseAdminRoute(window.location.href);
	if (route.view === "posts") {
		currentPostId = route.resourceId;
		editorMounted = true;
	}
	const unsubscribe = subscribeAdminRoute((nextRoute) => {
		if (skipNextRouteConfirmation) skipNextRouteConfirmation = false;
		else if (!confirmNavigation(nextRoute)) {
			replaceAdminRoute(route);
			return;
		}
		const filtersChanged =
			JSON.stringify(nextRoute.postFilters) !==
			JSON.stringify(route.postFilters);
		route = nextRoute;
		if (nextRoute.view === "posts") {
			currentPostId = nextRoute.resourceId;
			editorMounted = true;
			if (filtersChanged) void loadDrafts(nextRoute.postFilters);
		}
	});
	const handleBeforeUnload = (event: BeforeUnloadEvent) => {
		if (!shouldProtectBeforeUnload(editorDirty)) return;
		event.preventDefault();
		event.returnValue = "";
	};
	window.addEventListener("beforeunload", handleBeforeUnload);
	if (initialView === "app") loadSession();
	else loading = false;
	return () => {
		unsubscribe();
		window.removeEventListener("beforeunload", handleBeforeUnload);
	};
});
</script>

<svelte:head><title>{authenticated ? "写作后台" : "管理员登录"}</title></svelte:head>

{#if loading}<main class="admin-shell admin-loading"><span class="admin-spinner"></span><p>正在验证安全会话…</p></main>{:else if !authenticated}<LoginView submitting={loggingIn} {error} onsubmit={login} />{:else}
		<AdminShell {route} {error} {notice} onnavigate={navigate} onnewpost={() => navigate("posts", null)} onlogout={logout} onclearerror={() => error = ""} onclearnotice={() => notice = ""}>
			{#if route.view === "dashboard"}<DashboardView {drafts} loading={draftsLoading} onnavigate={(view) => navigate(view)} onopenpost={(id) => navigate("posts", id)} onerror={(message) => error = message} />
			{:else if route.view === "posts" || (route.view === "media" && editorMounted)}<section class:hidden={route.view !== "posts"} class="admin-view admin-posts-view"><PostListView {drafts} selectedId={currentPostId} loading={draftsLoading} page={draftPage} pageSize={draftPageSize} total={draftTotal} filters={route.postFilters} onselect={(id) => navigate("posts", id)} onfilters={updatePostFilters} onimport={() => importDialogOpen = true} /><PostEditorView resourceId={currentPostId} {mediaInsert} {mediaCover} onupdated={updateDraft} ondeleted={deleteDraft} oncreated={(id) => navigate("posts", id)} onmedia={() => navigate("media")} onerror={(message) => error = message} onnotice={(message) => notice = message} ondirtychange={(dirty) => editorDirty = dirty} /></section>
			{#if route.view === "media"}<MediaView onerror={(message) => error = message} onnotice={(message) => notice = message} onstate={(state) => { mediaCount = state.count; mediaUnavailable = state.unavailable; }} oninsert={insertMedia} oncover={setCover} />{/if}
			{:else if route.view === "media"}<MediaView onerror={(message) => error = message} onnotice={(message) => notice = message} onstate={(state) => { mediaCount = state.count; mediaUnavailable = state.unavailable; }} oninsert={insertMedia} oncover={setCover} />
			{:else if route.view === "pages"}<PagesView initialPageKey={route.resourceId} onerror={(message) => error = message} onnotice={(message) => notice = message} ondirtychange={(dirty) => pagesDirty = dirty} />
			{:else if route.view === "friends" || route.view === "gallery" || route.view === "announcement" || route.view === "sponsor" || route.view === "tools"}<StructuredConfigEditor groupKey={route.view} onerror={(message) => error = message} onnotice={(message) => notice = message} ondirtychange={(dirty) => pagesDirty = dirty} />
			{:else if route.view === "settings"}<SettingsView onerror={(message) => error = message} onnotice={(message) => notice = message} />
			{:else if route.view === "publishing"}<PublishingView onerror={(message) => error = message} onnotice={(message) => notice = message} onopenpost={(id) => navigate("posts", id)} />
			{:else}<SecurityView onerror={(message) => error = message} onnotice={(message) => notice = message} />{/if}
		</AdminShell>
	{#if importDialogOpen}<PostImportDialog onclose={() => importDialogOpen = false} onimported={importDraft} onerror={(message) => error = message} />{/if}
{/if}
