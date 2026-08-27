import type { PostFilterState } from "./admin-types";

const publicationStates = new Set(["all", "draft", "published", "withdrawn"]);
const workspaceStates = new Set(["all", "clean", "modified"]);
const syncStatuses = new Set([
	"all",
	"local",
	"publishing",
	"published",
	"modified",
	"reconciliation_required",
]);

export const defaultPostFilters: PostFilterState = {
	query: "",
	publicationState: "all",
	workspaceState: "all",
	syncStatus: "all",
	tag: "",
	category: "",
	page: 1,
};

const text = (url: URL, name: string, maximum: number): string => {
	const value = (url.searchParams.get(name) ?? "").trim();
	return value.length <= maximum ? value : "";
};

const choice = <T extends string>(
	url: URL,
	name: string,
	values: Set<string>,
): T => {
	const value = url.searchParams.get(name) ?? "all";
	return (values.has(value) ? value : "all") as T;
};

export const parsePostFilterState = (url: URL): PostFilterState => {
	const rawPage = url.searchParams.get("page") ?? "1";
	const page =
		/^\d+$/.test(rawPage) && Number(rawPage) > 0 ? Number(rawPage) : 1;
	return {
		query: text(url, "q", 200),
		publicationState: choice(url, "publicationState", publicationStates),
		workspaceState: choice(url, "workspaceState", workspaceStates),
		syncStatus: choice(url, "syncStatus", syncStatuses),
		tag: text(url, "tag", 100),
		category: text(url, "category", 100),
		page,
	};
};

export const appendPostFilters = (
	search: URLSearchParams,
	filters: PostFilterState,
): void => {
	if (filters.query) search.set("q", filters.query);
	if (filters.publicationState !== "all")
		search.set("publicationState", filters.publicationState);
	if (filters.workspaceState !== "all")
		search.set("workspaceState", filters.workspaceState);
	if (filters.syncStatus !== "all")
		search.set("syncStatus", filters.syncStatus);
	if (filters.tag) search.set("tag", filters.tag);
	if (filters.category) search.set("category", filters.category);
	if (filters.page !== 1) search.set("page", String(filters.page));
};

export const postFilterQuery = (
	filters: PostFilterState,
	pageSize: number,
): string => {
	const search = new URLSearchParams();
	appendPostFilters(search, filters);
	search.set("page", String(filters.page));
	search.set("pageSize", String(pageSize));
	return search.toString();
};
