import type { AdminRoute, AdminView } from "./admin-types";
import { appendPostFilters, parsePostFilterState } from "./post-filters";

const adminViews = new Set<AdminView>([
	"dashboard",
	"posts",
	"media",
	"pages",
	"friends",
	"gallery",
	"announcement",
	"sponsor",
	"tools",
	"music",
	"settings",
	"publishing",
	"security",
]);

// 页面视图通过 id 携带 page key；内容分组视图固定分组无需 id
const viewsWithResourceId = new Set<AdminView>(["posts", "pages"]);

export function parseAdminRoute(input: string | URL): AdminRoute {
	const url = input instanceof URL ? input : new URL(input, "http://localhost");
	const requestedView = url.searchParams.get("view");
	const view = adminViews.has(requestedView as AdminView)
		? (requestedView as AdminView)
		: "dashboard";
	return {
		view,
		resourceId: viewsWithResourceId.has(view)
			? url.searchParams.get("id")
			: null,
		postFilters: parsePostFilterState(url),
	};
}

export function formatAdminUrl(route: AdminRoute): string {
	const search = new URLSearchParams();
	search.set("view", route.view);
	if (route.resourceId && viewsWithResourceId.has(route.view))
		search.set("id", route.resourceId);
	if (route.view === "posts") appendPostFilters(search, route.postFilters);
	return `/admin/?${search.toString()}`;
}

function toPlainRoute(route: AdminRoute): AdminRoute {
	return {
		view: route.view,
		resourceId: route.resourceId,
		postFilters: {
			query: route.postFilters.query,
			publicationState: route.postFilters.publicationState,
			workspaceState: route.postFilters.workspaceState,
			syncStatus: route.postFilters.syncStatus,
			tag: route.postFilters.tag,
			category: route.postFilters.category,
			page: route.postFilters.page,
		},
	};
}

export function pushAdminRoute(route: AdminRoute): void {
	const snapshot = toPlainRoute(route);
	window.history.pushState(snapshot, "", formatAdminUrl(route));
	window.dispatchEvent(new PopStateEvent("popstate", { state: snapshot }));
}

export function replaceAdminRoute(route: AdminRoute): void {
	window.history.replaceState(toPlainRoute(route), "", formatAdminUrl(route));
}

export function subscribeAdminRoute(
	listener: (route: AdminRoute) => void,
): () => void {
	const handlePopState = () => listener(parseAdminRoute(window.location.href));
	window.addEventListener("popstate", handlePopState);
	return () => window.removeEventListener("popstate", handlePopState);
}
