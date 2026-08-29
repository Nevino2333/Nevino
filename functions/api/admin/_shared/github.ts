import { isAllowedGitHubPath } from "./allowed-paths";
import { ApiError } from "./errors";
import type { DraftRow, Env } from "./types";

const apiBase = "https://api.github.com";
const commitShaPattern = /^[0-9a-f]{40}$/i;

export type GitHubConfig = {
	token: string;
	owner: string;
	repo: string;
	branch: string;
};

export type GitHubContent = {
	sha: string;
	content?: string;
	encoding?: string;
};

export type GitHubPostTreeItem = {
	path: string;
	sha: string;
};

export type GitHubComparisonStatus =
	| "identical"
	| "ahead"
	| "behind"
	| "diverged";

export type GitHubHistoryItem = {
	sha: string;
	message: string;
	authorName: string;
	authorDate: string;
};

export type GitHubTreeCommit = {
	blobSha: string | null;
	commitSha: string;
};

type GitHubCommit = {
	commit: { sha: string };
	content: { sha: string };
};

export const getGitHubConfig = (env: Env): GitHubConfig | null => {
	const token = env.GITHUB_TOKEN?.trim();
	const owner = env.GITHUB_OWNER?.trim();
	const repo = env.GITHUB_REPO?.trim();
	const branch = env.GITHUB_BRANCH?.trim();
	if (token && owner && repo && branch && branch !== "master")
		throw new ApiError(
			503,
			"github_branch_mismatch",
			"GitHub 发布分支必须为 master",
		);
	return token &&
		owner &&
		repo &&
		branch &&
		/^[A-Za-z0-9_.-]+$/.test(owner) &&
		/^[A-Za-z0-9_.-]+$/.test(repo) &&
		branch.length <= 255 &&
		![...branch].some(
			(character) =>
				character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
		)
		? { token, owner, repo, branch }
		: null;
};

export const githubPathForDraft = (draft: DraftRow): string =>
	`src/content/posts/${draft.slug}/index.md`;
export { isAllowedGitHubPath };

const repositoryUrl = (config: GitHubConfig, path: string): URL =>
	new URL(
		`${apiBase}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/${path}`,
	);

const headers = (config: GitHubConfig, body = false): HeadersInit => ({
	Accept: "application/vnd.github+json",
	Authorization: `Bearer ${config.token}`,
	// GitHub API 强制要求 User-Agent；Workers 的 fetch 默认不携带，缺失会被 403 拒绝
	"User-Agent": "Nevino-Blog-Admin/1.0 (+https://nevino2333.pages.dev)",
	"X-GitHub-Api-Version": "2022-11-28",
	...(body ? { "Content-Type": "application/json" } : {}),
});

const request = async (
	config: GitHubConfig,
	path: string,
	init?: RequestInit,
	ref = config.branch,
): Promise<Response> => {
	const url = repositoryUrl(
		config,
		`contents/${path.split("/").map(encodeURIComponent).join("/")}`,
	);
	url.searchParams.set("ref", ref);
	return fetch(url, {
		...init,
		headers: {
			...headers(config, Boolean(init?.body)),
			...(init?.headers || {}),
		},
	});
};

const githubError = (status: number, operation: "read" | "write"): ApiError => {
	if (status === 404)
		return new ApiError(404, "github_not_found", "GitHub 资源不存在");
	if (status === 409 || status === 422)
		return new ApiError(409, "github_conflict", "GitHub 资源发生冲突");
	if (status === 403 || status === 429)
		return new ApiError(503, "github_rate_limited", "GitHub 请求受限", true);
	return new ApiError(
		502,
		`github_${operation}_failed`,
		"GitHub 请求失败",
		true,
	);
};

const json = async <T>(
	response: Response,
	operation: "read" | "write",
): Promise<T> => {
	if (!response.ok) throw githubError(response.status, operation);
	return response.json() as Promise<T>;
};

export const getGitHubHead = async (config: GitHubConfig): Promise<string> => {
	const url = repositoryUrl(
		config,
		`git/ref/heads/${encodeURIComponent(config.branch)}`,
	);
	const result = await json<{ object?: { sha?: string } }>(
		await fetch(url, { headers: headers(config) }),
		"read",
	);
	if (!result.object?.sha)
		throw new ApiError(502, "github_read_failed", "GitHub HEAD 无效");
	return result.object.sha;
};

export const getGitHubFile = async (
	config: GitHubConfig,
	path: string,
): Promise<GitHubContent | null> => {
	const response = await request(config, path);
	if (response.status === 404) return null;
	return json<GitHubContent>(response, "read");
};

export const listGitHubPostCandidates = async (
	config: GitHubConfig,
): Promise<GitHubPostTreeItem[]> => {
	const url = repositoryUrl(
		config,
		`git/trees/${encodeURIComponent(config.branch)}`,
	);
	url.searchParams.set("recursive", "1");
	const result = await json<{
		truncated?: boolean;
		tree?: { path?: string; type?: string; sha?: string }[];
	}>(await fetch(url, { headers: headers(config) }), "read");
	if (result.truncated)
		throw new ApiError(502, "github_tree_truncated", "GitHub 文件树不完整");
	return (result.tree ?? [])
		.filter((item) => item.type === "blob" && typeof item.path === "string")
		.map((item) => ({ path: item.path as string, sha: item.sha ?? "" }))
		.filter(
			(item) =>
				item.path.startsWith("src/content/posts/") &&
				(item.path.endsWith("/index.md") || item.path.endsWith("/index.mdx")),
		)
		.sort((left, right) => left.path.localeCompare(right.path));
};

export const listGitHubPostPaths = async (
	config: GitHubConfig,
): Promise<string[]> =>
	(await listGitHubPostCandidates(config))
		.filter((item) => isAllowedGitHubPath(item.path))
		.map((item) => item.path);

export const getGitHubFileAtRef = async (
	config: GitHubConfig,
	path: string,
	ref: string,
): Promise<GitHubContent> => {
	if (!isAllowedGitHubPath(path))
		throw new ApiError(400, "path_not_allowed", "GitHub 路径不允许");
	if (!commitShaPattern.test(ref))
		throw new ApiError(400, "github_ref_invalid", "GitHub ref 无效");
	const result = await json<GitHubContent & { type?: string }>(
		await request(config, path, undefined, ref),
		"read",
	);
	if (
		result.type === "dir" ||
		result.encoding !== "base64" ||
		typeof result.content !== "string"
	)
		throw new ApiError(502, "github_read_failed", "GitHub 文件格式无效");
	return result;
};

export const listGitHubFileHistory = async (
	config: GitHubConfig,
	path: string,
	page: number,
	pageSize: number,
): Promise<GitHubHistoryItem[]> => {
	if (!isAllowedGitHubPath(path))
		throw new ApiError(400, "path_not_allowed", "GitHub 路径不允许");
	if (
		!Number.isInteger(page) ||
		page < 1 ||
		!Number.isInteger(pageSize) ||
		pageSize < 1 ||
		pageSize > 50
	)
		throw new ApiError(400, "github_pagination_invalid", "GitHub 分页参数无效");
	const url = repositoryUrl(config, "commits");
	url.searchParams.set("path", path);
	url.searchParams.set("sha", config.branch);
	url.searchParams.set("page", String(page));
	url.searchParams.set("per_page", String(pageSize));
	const result = await json<
		Array<{
			sha?: string;
			commit?: { message?: string; author?: { name?: string; date?: string } };
		}>
	>(await fetch(url, { headers: headers(config) }), "read");
	return result.map((item) => ({
		sha: item.sha ?? "",
		message: (item.commit?.message ?? "").split("\n", 1)[0],
		authorName: item.commit?.author?.name ?? "",
		authorDate: item.commit?.author?.date ?? "",
	}));
};

export const compareGitHubCommits = async (
	config: GitHubConfig,
	base: string,
	head: string,
): Promise<GitHubComparisonStatus> => {
	const url = repositoryUrl(
		config,
		`compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
	);
	const result = await json<{ status?: unknown }>(
		await fetch(url, { headers: headers(config) }),
		"read",
	);
	if (
		result.status !== "identical" &&
		result.status !== "ahead" &&
		result.status !== "behind" &&
		result.status !== "diverged"
	)
		throw new ApiError(502, "github_compare_failed", "GitHub 比较失败", true);
	return result.status;
};

const encodeContent = (content: string): string =>
	btoa(unescape(encodeURIComponent(content)));

const writeGitHubFile = async (
	config: GitHubConfig,
	path: string,
	body: Record<string, string>,
): Promise<GitHubCommit> => {
	if (!isAllowedGitHubPath(path))
		throw new ApiError(400, "path_not_allowed", "GitHub 路径不允许");
	return json<GitHubCommit>(
		await request(config, path, { method: "PUT", body: JSON.stringify(body) }),
		"write",
	);
};

export const createGitHubFile = (
	config: GitHubConfig,
	path: string,
	content: string,
	message: string,
): Promise<GitHubCommit> =>
	writeGitHubFile(config, path, {
		message,
		content: encodeContent(content),
		branch: config.branch,
	});

export const updateGitHubFile = async (
	config: GitHubConfig,
	path: string,
	content: string,
	expectedSha: string,
	message: string,
): Promise<GitHubCommit> => {
	if (!expectedSha.trim())
		throw new ApiError(400, "expected_sha_required", "expected SHA 必填");
	return writeGitHubFile(config, path, {
		message,
		content: encodeContent(content),
		branch: config.branch,
		sha: expectedSha,
	});
};

const commitTreeChange = async (
	config: GitHubConfig,
	path: string,
	expectedHeadCommitSha: string,
	message: string,
	changes: { path: string; sha: string | null }[],
	content?: string,
): Promise<GitHubTreeCommit> => {
	if (
		!isAllowedGitHubPath(path) ||
		changes.some((change) => !isAllowedGitHubPath(change.path))
	)
		throw new ApiError(400, "path_not_allowed", "GitHub 路径不允许");
	const refUrl = repositoryUrl(
		config,
		`git/ref/heads/${encodeURIComponent(config.branch)}`,
	);
	const ref = await json<{ object?: { sha?: string } }>(
		await fetch(refUrl, { headers: headers(config) }),
		"read",
	);
	if (ref.object?.sha !== expectedHeadCommitSha)
		throw new ApiError(409, "github_head_changed", "GitHub HEAD 已变化");
	const commitUrl = repositoryUrl(
		config,
		`git/commits/${encodeURIComponent(expectedHeadCommitSha)}`,
	);
	const base = await json<{ tree?: { sha?: string } }>(
		await fetch(commitUrl, { headers: headers(config) }),
		"read",
	);
	let blobSha: string | null = null;
	let treeChanges = changes;
	if (content !== undefined) {
		const blobUrl = repositoryUrl(config, "git/blobs");
		const blob = await json<{ sha?: string }>(
			await fetch(blobUrl, {
				method: "POST",
				headers: headers(config, true),
				body: JSON.stringify({ content, encoding: "utf-8" }),
			}),
			"write",
		);
		blobSha = blob.sha ?? null;
		treeChanges = changes.map((change) =>
			change.sha === "__new__" ? { ...change, sha: blobSha } : change,
		);
	}
	const treeUrl = repositoryUrl(config, "git/trees");
	const tree = await json<{ sha?: string }>(
		await fetch(treeUrl, {
			method: "POST",
			headers: headers(config, true),
			body: JSON.stringify({
				base_tree: base.tree?.sha,
				tree: treeChanges.map((change) => ({
					...change,
					mode: "100644",
					type: "blob",
				})),
			}),
		}),
		"write",
	);
	const newCommit = await json<{ sha?: string }>(
		await fetch(repositoryUrl(config, "git/commits"), {
			method: "POST",
			headers: headers(config, true),
			body: JSON.stringify({
				message,
				parents: [expectedHeadCommitSha],
				tree: tree.sha,
			}),
		}),
		"write",
	);
	const update = await fetch(
		repositoryUrl(
			config,
			`git/refs/heads/${encodeURIComponent(config.branch)}`,
		),
		{
			method: "PATCH",
			headers: headers(config, true),
			body: JSON.stringify({ sha: newCommit.sha, force: false }),
		},
	);
	await json(update, "write");
	return { blobSha, commitSha: newCommit.sha ?? "" };
};

export const commitGitHubRename = (
	config: GitHubConfig,
	sourcePath: string,
	targetPath: string,
	content: string,
	expectedHeadCommitSha: string,
	message: string,
): Promise<GitHubTreeCommit> =>
	commitTreeChange(
		config,
		sourcePath,
		expectedHeadCommitSha,
		message,
		[
			{ path: sourcePath, sha: null },
			{ path: targetPath, sha: "__new__" },
		],
		content,
	);

export const commitGitHubDelete = (
	config: GitHubConfig,
	path: string,
	expectedHeadCommitSha: string,
	message: string,
): Promise<GitHubTreeCommit> =>
	commitTreeChange(config, path, expectedHeadCommitSha, message, [
		{ path, sha: null },
	]);

export const commitGitHubUpdate = async (
	config: GitHubConfig,
	path: string,
	content: string,
	expectedBlobSha: string,
	expectedHeadCommitSha: string,
	message: string,
): Promise<GitHubTreeCommit> => {
	if (!expectedBlobSha.trim())
		throw new ApiError(400, "expected_sha_required", "expected SHA 必填");
	const current = await getGitHubFileAtRef(config, path, expectedHeadCommitSha);
	if (current.sha !== expectedBlobSha)
		throw new ApiError(409, "content_blob_conflict", "远端内容已变化");
	return commitTreeChange(
		config,
		path,
		expectedHeadCommitSha,
		message,
		[{ path, sha: "__new__" }],
		content,
	);
};

export const decodeGitHubContent = (content: GitHubContent): string | null => {
	if (content.encoding !== "base64" || typeof content.content !== "string")
		return null;
	try {
		const binary = atob(content.content.replaceAll("\n", ""));
		return new TextDecoder().decode(
			Uint8Array.from(binary, (character) => character.charCodeAt(0)),
		);
	} catch {
		return null;
	}
};

// 一次树提交写入多个文本文件（设置批量发布）。
// 每个 change 携带期望的 blob sha，任何远端漂移都会在提交前暴露。
export const commitGitHubFiles = async (
	config: GitHubConfig,
	changes: { path: string; content: string; expectedBlobSha: string }[],
	expectedHeadCommitSha: string,
	message: string,
): Promise<{ commitSha: string }> => {
	if (changes.length === 0)
		throw new ApiError(400, "invalid_request", "没有可提交的文件变更");
	const head = await getGitHubHead(config);
	if (head !== expectedHeadCommitSha)
		throw new ApiError(409, "github_head_changed", "GitHub HEAD 已变化");
	const verified: { path: string; sha: string }[] = [];
	for (const change of changes) {
		if (!change.expectedBlobSha.trim())
			throw new ApiError(400, "expected_sha_required", "expected SHA 必填");
		const current = await getGitHubFileAtRef(
			config,
			change.path,
			expectedHeadCommitSha,
		);
		if (current.sha !== change.expectedBlobSha)
			throw new ApiError(
				409,
				"content_blob_conflict",
				"远端内容已变化，请刷新后重试",
			);
		verified.push({ path: change.path, sha: "__new__" });
	}
	const blobs: string[] = [];
	for (const change of changes) {
		const blobUrl = repositoryUrl(config, "git/blobs");
		const blob = await json<{ sha?: string }>(
			await fetch(blobUrl, {
				method: "POST",
				headers: headers(config, true),
				body: JSON.stringify({ content: change.content, encoding: "utf-8" }),
			}),
			"write",
		);
		blobs.push(blob.sha ?? "");
	}
	const tree = verified.map((change, index) => ({
		path: change.path,
		sha: blobs[index],
	}));
	const commitUrl = repositoryUrl(
		config,
		`git/commits/${encodeURIComponent(expectedHeadCommitSha)}`,
	);
	const base = await json<{ tree?: { sha?: string } }>(
		await fetch(commitUrl, { headers: headers(config) }),
		"read",
	);
	const treeUrl = repositoryUrl(config, "git/trees");
	const treeResult = await json<{ sha?: string }>(
		await fetch(treeUrl, {
			method: "POST",
			headers: headers(config, true),
			body: JSON.stringify({
				base_tree: base.tree?.sha,
				tree: tree.map((change) => ({
					...change,
					mode: "100644",
					type: "blob",
				})),
			}),
		}),
		"write",
	);
	const newCommit = await json<{ sha?: string }>(
		await fetch(repositoryUrl(config, "git/commits"), {
			method: "POST",
			headers: headers(config, true),
			body: JSON.stringify({
				message,
				parents: [expectedHeadCommitSha],
				tree: treeResult.sha,
			}),
		}),
		"write",
	);
	const update = await fetch(
		repositoryUrl(
			config,
			`git/refs/heads/${encodeURIComponent(config.branch)}`,
		),
		{
			method: "PATCH",
			headers: headers(config, true),
			body: JSON.stringify({ sha: newCommit.sha, force: false }),
		},
	);
	await json(update, "write");
	return { commitSha: newCommit.sha ?? "" };
};

// 通过 workflow_dispatch 触发 Cloudflare Pages 部署工作流重新构建。
export const dispatchGitHubWorkflow = async (
	config: GitHubConfig,
	workflowFile: string,
): Promise<void> => {
	if (!/^[A-Za-z0-9_./-]+\.ya?ml$/.test(workflowFile))
		throw new ApiError(400, "invalid_request", "工作流文件名无效");
	const url = repositoryUrl(
		config,
		`actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`,
	);
	const response = await fetch(url, {
		method: "POST",
		headers: headers(config, true),
		body: JSON.stringify({ ref: config.branch }),
	});
	if (!response.ok) {
		if (response.status === 403 || response.status === 404)
			throw new ApiError(
				403,
				"github_workflow_not_allowed",
				"GITHUB_TOKEN 没有触发工作流的权限（需要 actions:write）",
			);
		throw githubError(response.status, "write");
	}
};
