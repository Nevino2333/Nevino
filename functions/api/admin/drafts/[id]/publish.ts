import type { PagesFunction } from "../../_shared/types";
import { requireAuth, requireCsrf, requireOrigin } from "../../_shared/auth";
import { getDraft, run } from "../../_shared/db";
import { getGitHubConfig, getGitHubFile, githubPathForDraft, isAllowedGitHubPath, putGitHubFile } from "../../_shared/github";
import { audit } from "../../_shared/audit";
import { json } from "../../_shared/security";
import { readJson } from "../../_shared/body";
import { toMarkdown, validateMarkdown } from "../../_shared/markdown";

const PUBLISH_BODY_LIMIT = 4096;

const idOf = (context: { params: Record<string, string | undefined> }): string => context.params.id ?? "";

type PublishInput = { githubSha?: string | null };

export const onRequestPost: PagesFunction = async (context) => {
	const denied = requireOrigin(context.request, context.env);
	if (denied) return denied;
	const auth = await requireAuth(context);
	if (auth.response) return auth.response;
	const csrf = await requireCsrf(context, auth.session);
	if (csrf) return csrf;
	const config = getGitHubConfig(context.env);
	if (!config) return json({ error: "github_not_configured" }, 503);
	let input: PublishInput = {};
	const parsed = await readJson(context.request, PUBLISH_BODY_LIMIT);
	if (parsed.response) return json({ error: "invalid_request" }, parsed.response.status);
	const body = parsed.data;
	if (body && typeof body === "object" && "githubSha" in body) {
		const value = (body as { githubSha?: unknown }).githubSha;
		if (value !== null && value !== undefined && typeof value !== "string") return json({ error: "invalid_request" }, 400);
		input = { githubSha: value as string | null | undefined };
	}
	const draft = await getDraft(context.env, idOf(context));
	if (!draft) return json({ error: "not_found" }, 404);
	if (draft.status === "published") return json({ error: "draft_immutable" }, 409);
	const path = githubPathForDraft(draft);
	if (!isAllowedGitHubPath(path)) return json({ error: "path_not_allowed" }, 422);
	if (input.githubSha !== undefined && input.githubSha !== draft.github_sha) return json({ error: "draft_changed" }, 409);
	let tags: string[];
	try {
		const parsed = JSON.parse(draft.tags_json);
		if (!Array.isArray(parsed) || !parsed.every((tag) => typeof tag === "string")) return json({ error: "markdown_invalid" }, 422);
		tags = parsed;
	} catch {
		return json({ error: "markdown_invalid" }, 422);
	}
	const markdown = toMarkdown({ slug: draft.slug, title: draft.title, published: draft.published, updated: draft.updated ?? undefined, description: draft.description, aiSummary: draft.ai_summary, image: draft.image, tags, category: draft.category, lang: draft.lang, pinned: draft.pinned === 1, author: draft.author, sourceLink: draft.source_link, licenseName: draft.license_name, licenseUrl: draft.license_url, comment: draft.comment === 1, content: draft.content });
	if (!validateMarkdown(markdown)) return json({ error: "markdown_invalid" }, 422);
	try {
		const remote = await getGitHubFile(config, path);
		if (draft.github_sha && (!remote || remote.sha !== draft.github_sha)) return json({ error: "github_conflict" }, 409);
		const result = await putGitHubFile(config, path, markdown.replace("draft: true", "draft: false"), remote?.sha, `Publish ${draft.slug}`);
		const now = new Date().toISOString();
		const updated = await run(context.env.DB, "UPDATE admin_drafts SET status = ?, github_path = ?, github_sha = ?, commit_sha = ?, updated_at = ? WHERE id = ? AND updated_at = ?", "published", path, result.content.sha, result.commit.sha, now, draft.id, draft.updated_at);
		if (!updated.meta.changes) return json({ error: "draft_changed" }, 409);
		await audit(context.env, auth.session.user_id, "draft_publish", context.request, { id: draft.id, path, commit_sha: result.commit.sha });
		return json({ ok: true, draft: await getDraft(context.env, draft.id), path, commitSha: result.commit.sha });
	} catch (cause) {
		const error = cause instanceof Error ? cause.message : "";
		return json({ error: error === "github_conflict" ? error : "github_write_failed" }, error === "github_conflict" ? 409 : 502);
	}
};
