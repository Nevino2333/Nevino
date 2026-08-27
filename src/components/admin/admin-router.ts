import type { AdminRoute, AdminView } from "./admin-types";
import { appendPostFilters, parsePostFilterState } from "./post-filters";

const adminViews = new Set<AdminView>([
	"dashboard",
	"posts",
	"media",
	"pages",
	"settings",
	"publishing",
	"security",
]);

export function parseAdminRoute(input: string | URL): AdminRoute {
	const url = input instanceof URL ? input : new URL(input, "http://localhost");
	const requestedView = url.searchParams.get("view");
	const view = adminViews.has(requestedView as AdminView)
		? (requestedView as AdminView)
		: "dashboard";
	return {
		view,
		resourceId: view === "posts" ? url.searchParams.get("id") : null,
		postFilters: parsePostFilterState(url),
	};
}

export function formatAdminUrl(route: AdminRoute): string {
	const search = new URLSearchParams();
	search.set("view", route.view);
	if (route.resourceId) search.set("id", route.resourceId);
	if (route.view === "posts") appendPostFilters(search, route.postFilters);
	return `/admin/?${search.toString()}`;
}

export function pushAdminRoute(route: AdminRoute): void {
	window.history.pushState(route, "", formatAdminUrl(route));
	window.dispatchEvent(new PopStateEvent("popstate", { state: route }));
}

export function replaceAdminRoute(route: AdminRoute): void {
	window.history.replaceState(route, "", formatAdminUrl(route));
}

export function subscribeAdminRoute(
	listener: (route: AdminRoute) => void,
): () => void {
	const handlePopState = () => listener(parseAdminRoute(window.location.href));
	window.addEventListener("popstate", handlePopState);
	return () => window.removeEventListener("popstate", handlePopState);
}
