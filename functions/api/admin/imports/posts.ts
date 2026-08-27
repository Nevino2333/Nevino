import { audit, bestEffortAudit } from "../_shared/audit";
import { readJson } from "../_shared/body";
import type { PostImportCandidatePageDto } from "../_shared/contracts";
import { ApiError } from "../_shared/errors";
import {
	decodeGitHubContent,
	getGitHubConfig,
	getGitHubFileAtRef,
	getGitHubHead,
	listGitHubPostCandidates,
} from "../_shared/github";
import { adminGet, adminMutation } from "../_shared/handler";
import { ContentOperationRepository } from "../_shared/repositories/content-operation-repository";
import { DraftRepository } from "../_shared/repositories/draft-repository";
import { randomToken } from "../_shared/security";
import {
	ContentOperationService,
	classifyImportCandidates,
} from "../_shared/services/content-operation-service";
import { toDetail } from "../_shared/services/content-service";

const githubConfig = (env: Parameters<typeof getGitHubConfig>[0]) => {
	const config = getGitHubConfig(env);
	if (!config)
		throw new ApiError(503, "github_not_configured", "GitHub 未配置");
	return config;
};

export const onRequestGet = adminGet<PostImportCandidatePageDto>(
	async (context) => {
		const config = githubConfig(context.env);
		const url = new URL(context.request.url);
		const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
		const pageSize = Math.min(
			50,
			Math.max(1, Number(url.searchParams.get("pageSize")) || 20),
		);
		const tree = await listGitHubPostCandidates(config);
		const repository = new DraftRepository(context.env);
		const bindings = await repository.listBindingsByPaths(
			tree.map((item) => item.path),
		);
		const classified = classifyImportCandidates(
			tree.map((item) => item.path),
			bindings,
		);
		const shaByPath = new Map(tree.map((item) => [item.path, item.sha]));
		const items = classified
			.slice((page - 1) * pageSize, page * pageSize)
			.map((item) => ({
				...item,
				expectedSha: shaByPath.get(item.path) ?? "",
			}));
		return { items, page, pageSize, total: classified.length };
	},
);

export const onRequestPost = adminMutation(async (context) => {
	const parsed = await readJson(context.request, 4096);
	if (parsed.response || !parsed.data || typeof parsed.data !== "object")
		throw new ApiError(400, "invalid_request", "导入请求无效");
	const body = parsed.data as Record<string, unknown>;
	if (
		typeof body.path !== "string" ||
		typeof body.expectedSha !== "string" ||
		typeof body.idempotencyKey !== "string"
	)
		throw new ApiError(400, "invalid_request", "导入请求无效");
	const config = githubConfig(context.env);
	const drafts = new DraftRepository(context.env);
	const operations = new ContentOperationRepository(context.env);
	const service = new ContentOperationService({
		store: {
			findByIdempotencyKey: (key) => operations.findByIdempotencyKey(key),
			findByPath: (path) => drafts.findByPath(path),
			findBySlug: (slug) => drafts.findBySlug(slug),
			createPending: (row) => operations.createPending(row),
			importPublished: (draft, revision) =>
				drafts.importPublished(draft, revision),
			markCompleted: (id, now, blobSha, commitSha) =>
				operations.markCompleted(id, now, blobSha, commitSha),
		},
		gateway: {
			getHead: () => getGitHubHead(config),
			getFile: async (path, ref) => {
				const content = await getGitHubFileAtRef(config, path, ref);
				const decoded = decodeGitHubContent(content);
				if (decoded === null)
					throw new ApiError(502, "github_read_failed", "GitHub 文件格式无效");
				return { sha: content.sha, content: decoded };
			},
		},
		now: () => new Date().toISOString(),
		newId: () => randomToken(16),
	});
	const draft = await service.importPost({
		path: body.path,
		expectedSha: body.expectedSha,
		idempotencyKey: body.idempotencyKey,
		userId: context.session.user_id,
	});
	await bestEffortAudit(() =>
		audit(
			context.env,
			context.session.user_id,
			"post_import",
			context.request,
			{
				requestId: context.requestId,
				resourceType: "draft",
				resourceId: draft.id,
				result: "success",
				metadata: {
					path: draft.github_path,
					blobSha: draft.github_sha,
					commitSha: draft.commit_sha,
				},
			},
		),
	);
	return { data: toDetail(draft), status: 201 };
});
