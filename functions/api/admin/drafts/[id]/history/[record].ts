import { ApiError } from "../../../_shared/errors";
import {
	decodeGitHubContent,
	getGitHubConfig,
	getGitHubFileAtRef,
	listGitHubFileHistory,
} from "../../../_shared/github";
import { adminGet } from "../../../_shared/handler";
import { toMarkdown } from "../../../_shared/markdown";
import { ContentOperationRepository } from "../../../_shared/repositories/content-operation-repository";
import { DraftRepository } from "../../../_shared/repositories/draft-repository";
import { RevisionRepository } from "../../../_shared/repositories/revision-repository";
import { HistoryDetailService } from "../../../_shared/services/history-detail-service";

const paramsOf = (context: { params: Record<string, string | undefined> }) => ({
	draftId: context.params.id ?? "",
	recordId: context.params.record ?? "",
});

export const onRequestGet = adminGet(async (context) => {
	const { draftId, recordId } = paramsOf(context);
	const draft = await new DraftRepository(context.env).get(draftId);
	if (!draft) throw new ApiError(404, "not_found", "文章不存在");
	const config = getGitHubConfig(context.env);
	if (!config)
		throw new ApiError(503, "github_not_configured", "GitHub 尚未配置", true);
	const operations = new ContentOperationRepository(context.env);
	const revisions = new RevisionRepository(context.env);
	const service = new HistoryDetailService({
		records: {
			async getTrustedRecord(contentId, candidateId) {
				const operation = candidateId.startsWith("operation:")
					? await operations.get(candidateId.slice(10))
					: null;
				if (
					operation?.content_id === contentId &&
					operation.commit_sha &&
					(operation.target_path ?? operation.source_path)
				)
					return {
						id: candidateId,
						contentId,
						path: operation.target_path ?? (operation.source_path as string),
						commitSha: operation.commit_sha,
					};
				if (candidateId.startsWith("revision:")) {
					const revision = await revisions.getByVersion(
						draftId,
						Number(candidateId.slice(9)),
					);
					if (revision?.content_id === contentId)
						return {
							id: candidateId,
							contentId,
							path:
								draft.deployed_path ??
								draft.github_path ??
								`src/content/posts/${revision.slug}/index.md`,
							commitSha: revision.github_commit_sha,
							blobSha: revision.github_blob_sha,
							markdown: revision.markdown,
						};
				}
				if (candidateId.startsWith("commit:")) {
					const commitSha = candidateId.slice(7);
					const paths = [
						...new Set(
							[draft.deployed_path, draft.github_path].filter(
								(path): path is string => Boolean(path),
							),
						),
					];
					for (const path of paths) {
						const history = await listGitHubFileHistory(config, path, 1, 50);
						if (history.some((item) => item.sha === commitSha))
							return { id: candidateId, contentId, path, commitSha };
					}
				}
				return null;
			},
		},
		github: {
			async getFile(path, commitSha) {
				const file = await getGitHubFileAtRef(config, path, commitSha);
				const content = decodeGitHubContent(file);
				if (content === null)
					throw new ApiError(502, "github_read_failed", "GitHub 文件格式无效");
				return { sha: file.sha, content };
			},
		},
	});
	return service.get({
		contentId: draft.content_id,
		recordId,
		currentMarkdown: toMarkdown(
			{
				slug: draft.slug,
				title: draft.title,
				published: draft.published,
				updated: draft.updated ?? undefined,
				description: draft.description,
				aiSummary: draft.ai_summary,
				image: draft.image,
				tags: JSON.parse(draft.tags_json) as string[],
				category: draft.category,
				lang: draft.lang,
				pinned: draft.pinned === 1,
				author: draft.author,
				sourceLink: draft.source_link,
				licenseName: draft.license_name,
				licenseUrl: draft.license_url,
				comment: draft.comment === 1,
				content: draft.content,
			},
			draft.publication_state === "published",
		),
	});
});
