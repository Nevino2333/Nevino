import { ApiError } from "../../_shared/errors";
import { getGitHubConfig, listGitHubFileHistory } from "../../_shared/github";
import { adminGet } from "../../_shared/handler";
import { ContentOperationRepository } from "../../_shared/repositories/content-operation-repository";
import { DraftRepository } from "../../_shared/repositories/draft-repository";
import { RevisionRepository } from "../../_shared/repositories/revision-repository";
import { ContentHistoryService } from "../../_shared/services/content-history-service";

const idOf = (context: {
	params: Record<string, string | undefined>;
}): string => context.params.id ?? "";

const pagination = (request: Request): { page: number; pageSize: number } => {
	const url = new URL(request.url);
	const page = Number(url.searchParams.get("page") ?? "1");
	const pageSize = Number(url.searchParams.get("pageSize") ?? "20");
	if (
		!Number.isSafeInteger(page) ||
		page < 1 ||
		!Number.isSafeInteger(pageSize) ||
		pageSize < 1 ||
		pageSize > 50
	)
		throw new ApiError(400, "history_pagination_invalid", "历史分页参数无效");
	return { page, pageSize };
};

export const onRequestGet = adminGet(async (context) => {
	const draft = await new DraftRepository(context.env).get(idOf(context));
	if (!draft) throw new ApiError(404, "not_found", "文章不存在");
	const config = getGitHubConfig(context.env);
	if (!config)
		throw new ApiError(503, "github_not_configured", "GitHub 尚未配置", true);
	const operationRows = await new ContentOperationRepository(
		context.env,
	).listByContentId(draft.content_id);
	const revisionRows = await new RevisionRepository(
		context.env,
	).listByContentId(draft.content_id);
	const paths = [
		...new Set(
			[
				draft.deployed_path,
				draft.github_path,
				...operationRows.flatMap((row) => [row.source_path, row.target_path]),
			].filter((path): path is string => Boolean(path)),
		),
	];
	const commitPages = await Promise.all(
		paths.map(async (path) => ({
			path,
			items: await listGitHubFileHistory(config, path, 1, 50),
		})),
	);
	const commits = commitPages.flatMap(({ path, items }) =>
		items.map((item) => ({ ...item, path })),
	);
	const pathByCommit = new Map(commits.map((item) => [item.sha, item.path]));
	const operations = operationRows.map((row) => ({
		id: row.id,
		contentId: row.content_id,
		type: row.type,
		status: row.status,
		path: row.target_path ?? row.source_path,
		commitSha: row.commit_sha,
		createdAt: row.created_at,
	}));
	const revisions = revisionRows.map((row) => ({
		id: row.id,
		contentId: row.content_id,
		source: row.source,
		version: row.version,
		path: row.github_commit_sha
			? (pathByCommit.get(row.github_commit_sha) ??
				draft.deployed_path ??
				draft.github_path)
			: null,
		commitSha: row.github_commit_sha,
		createdAt: row.created_at,
	}));
	return new ContentHistoryService().merge({
		contentId: draft.content_id,
		operations,
		revisions,
		commits,
		...pagination(context.request),
	});
});
