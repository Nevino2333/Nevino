import { ApiError } from "../errors";

export const postPublicationStates = [
	"all",
	"draft",
	"published",
	"withdrawn",
] as const;
export const postWorkspaceStates = ["all", "clean", "modified"] as const;
export const postSyncStatuses = [
	"all",
	"local",
	"publishing",
	"published",
	"modified",
	"reconciliation_required",
] as const;

export type PostPublicationState = (typeof postPublicationStates)[number];
export type PostWorkspaceState = (typeof postWorkspaceStates)[number];
export type PostSyncStatus = (typeof postSyncStatuses)[number];

export type PostFilters = {
	query: string;
	publicationState: PostPublicationState;
	workspaceState: PostWorkspaceState;
	syncStatus: PostSyncStatus;
	tag: string;
	category: string;
	page: number;
	pageSize: number;
};

const textLimits = {
	query: 200,
	tag: 100,
	category: 100,
} as const;

const validationError = (field: string): never => {
	throw new ApiError(422, "validation_failed", "文章筛选参数无效", false, {
		[field]: `${field} 无效`,
	});
};

const parseText = (
	url: URL,
	parameter: "q" | "tag" | "category",
	field: keyof typeof textLimits,
): string => {
	const value = (url.searchParams.get(parameter) ?? "").trim();
	if (value.length > textLimits[field]) validationError(field);
	return value;
};

const parseEnum = <T extends string>(
	url: URL,
	parameter: string,
	values: readonly T[],
): T => {
	const value = url.searchParams.get(parameter) ?? "all";
	if (!values.includes(value as T)) validationError(parameter);
	return value as T;
};

const parseInteger = (
	url: URL,
	parameter: "page" | "pageSize",
	defaultValue: number,
	maximum?: number,
): number => {
	const raw = url.searchParams.get(parameter);
	if (raw === null) return defaultValue;
	if (!/^\d+$/.test(raw)) validationError(parameter);
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 1 || (maximum && value > maximum))
		validationError(parameter);
	return value;
};

export const parsePostFilters = (url: URL): PostFilters => ({
	query: parseText(url, "q", "query"),
	publicationState: parseEnum(url, "publicationState", postPublicationStates),
	workspaceState: parseEnum(url, "workspaceState", postWorkspaceStates),
	syncStatus: parseEnum(url, "syncStatus", postSyncStatuses),
	tag: parseText(url, "tag", "tag"),
	category: parseText(url, "category", "category"),
	page: parseInteger(url, "page", 1),
	pageSize: parseInteger(url, "pageSize", 20, 100),
});

const escapeLike = (value: string): string =>
	value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

export const buildPostQuery = (
	filters: PostFilters,
): { whereSql: string; params: unknown[] } => {
	const conditions = ["deleted_at IS NULL"];
	const params: unknown[] = [];
	if (filters.query) {
		conditions.push(
			"(title LIKE ? ESCAPE '\\\\' OR slug LIKE ? ESCAPE '\\\\')",
		);
		const pattern = `%${escapeLike(filters.query)}%`;
		params.push(pattern, pattern);
	}
	if (filters.publicationState !== "all") {
		conditions.push("publication_state = ?");
		params.push(filters.publicationState);
	}
	if (filters.workspaceState !== "all") {
		conditions.push("workspace_state = ?");
		params.push(filters.workspaceState);
	}
	if (filters.syncStatus !== "all") {
		conditions.push("sync_status = ?");
		params.push(filters.syncStatus);
	}
	if (filters.tag) {
		conditions.push(
			"EXISTS (SELECT 1 FROM json_each(admin_drafts.tags_json) WHERE json_each.value = ?)",
		);
		params.push(filters.tag);
	}
	if (filters.category) {
		conditions.push("category = ?");
		params.push(filters.category);
	}
	return { whereSql: `WHERE ${conditions.join(" AND ")}`, params };
};
