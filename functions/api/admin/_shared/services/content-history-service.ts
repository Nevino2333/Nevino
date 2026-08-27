import { ApiError } from "../errors";

export type HistorySource = "operation" | "revision" | "github";

export type HistoryOperation = {
	id: string;
	contentId: string;
	type: string;
	status: string;
	path: string | null;
	commitSha: string | null;
	createdAt: string;
};

export type HistoryRevision = {
	id: string;
	contentId: string;
	source: string;
	version: number;
	path: string | null;
	commitSha: string | null;
	createdAt: string;
};

export type HistoryCommit = {
	sha: string;
	path: string;
	message: string;
	authorName: string;
	authorDate: string;
};

export type ContentHistoryItem = {
	id: string;
	contentId: string;
	createdAt: string;
	sources: HistorySource[];
	path: string | null;
	commitSha: string | null;
	operationId: string | null;
	revisionId: string | null;
	operationType: string | null;
	operationStatus: string | null;
	revisionSource: string | null;
	version: number | null;
	message: string | null;
	authorName: string | null;
};

type MergeInput = {
	contentId: string;
	operations: HistoryOperation[];
	revisions: HistoryRevision[];
	commits: HistoryCommit[];
	page: number;
	pageSize: number;
};

const sourceOrder: HistorySource[] = ["operation", "revision", "github"];

const validPagination = (page: number, pageSize: number): boolean =>
	Number.isSafeInteger(page) &&
	page > 0 &&
	Number.isSafeInteger(pageSize) &&
	pageSize > 0 &&
	pageSize <= 50;

export class ContentHistoryService {
	merge(input: MergeInput): {
		items: ContentHistoryItem[];
		page: number;
		pageSize: number;
		total: number;
	} {
		if (!validPagination(input.page, input.pageSize))
			throw new ApiError(400, "history_pagination_invalid", "历史分页参数无效");
		const items = new Map<string, ContentHistoryItem>();
		const merge = (
			key: string,
			item: ContentHistoryItem,
			source: HistorySource,
		): void => {
			const current = items.get(key);
			if (!current) {
				items.set(key, item);
				return;
			}
			items.set(key, {
				...current,
				createdAt:
					Date.parse(item.createdAt) > Date.parse(current.createdAt)
						? item.createdAt
						: current.createdAt,
				sources: sourceOrder.filter(
					(value) => current.sources.includes(value) || value === source,
				),
				path: current.path ?? item.path,
				operationId: current.operationId ?? item.operationId,
				revisionId: current.revisionId ?? item.revisionId,
				operationType: current.operationType ?? item.operationType,
				operationStatus: current.operationStatus ?? item.operationStatus,
				revisionSource: current.revisionSource ?? item.revisionSource,
				version: current.version ?? item.version,
				message: current.message ?? item.message,
				authorName: current.authorName ?? item.authorName,
			});
		};
		for (const operation of input.operations) {
			if (operation.contentId !== input.contentId) continue;
			const key = operation.commitSha
				? `commit:${operation.commitSha}`
				: `operation:${operation.id}`;
			merge(
				key,
				{
					id: key,
					contentId: input.contentId,
					createdAt: operation.createdAt,
					sources: ["operation"],
					path: operation.path,
					commitSha: operation.commitSha,
					operationId: operation.id,
					revisionId: null,
					operationType: operation.type,
					operationStatus: operation.status,
					revisionSource: null,
					version: null,
					message: null,
					authorName: null,
				},
				"operation",
			);
		}
		for (const revision of input.revisions) {
			if (revision.contentId !== input.contentId) continue;
			const key = revision.commitSha
				? `commit:${revision.commitSha}`
				: `revision:${revision.version}`;
			merge(
				key,
				{
					id: key,
					contentId: input.contentId,
					createdAt: revision.createdAt,
					sources: ["revision"],
					path: revision.path,
					commitSha: revision.commitSha,
					operationId: null,
					revisionId: revision.id,
					operationType: null,
					operationStatus: null,
					revisionSource: revision.source,
					version: revision.version,
					message: null,
					authorName: null,
				},
				"revision",
			);
		}
		for (const commit of input.commits) {
			const key = `commit:${commit.sha}`;
			merge(
				key,
				{
					id: key,
					contentId: input.contentId,
					createdAt: commit.authorDate,
					sources: ["github"],
					path: commit.path,
					commitSha: commit.sha,
					operationId: null,
					revisionId: null,
					operationType: null,
					operationStatus: null,
					revisionSource: null,
					version: null,
					message: commit.message,
					authorName: commit.authorName,
				},
				"github",
			);
		}
		const ordered = [...items.values()].sort(
			(left, right) =>
				Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
				right.id.localeCompare(left.id),
		);
		const offset = (input.page - 1) * input.pageSize;
		return {
			items: ordered.slice(offset, offset + input.pageSize),
			page: input.page,
			pageSize: input.pageSize,
			total: ordered.length,
		};
	}
}
