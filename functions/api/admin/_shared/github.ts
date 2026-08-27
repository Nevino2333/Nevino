import type { Draft, Env } from "./types";

const apiBase = "https://api.github.com";
const pathPattern = /^src\/content\/posts\/[a-z0-9]+(?:-[a-z0-9]+)*\/index\.md$/;

type GitHubConfig = {
	token: string;
	owner: string;
	repo: string;
	branch: string;
};

type GitHubContent = {
	sha: string;
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
	return token && owner && repo && branch && /^[A-Za-z0-9_.-]+$/.test(owner) && /^[A-Za-z0-9_.-]+$/.test(repo) && branch.length <= 255 && !/[\u0000-\u001f\u007f]/.test(branch) ? { token, owner, repo, branch } : null;
};

export const githubPathForDraft = (draft: Draft): string => `src/content/posts/${draft.slug}/index.md`;
export const isAllowedGitHubPath = (path: string): boolean => pathPattern.test(path);

const request = async (config: GitHubConfig, path: string, init?: RequestInit): Promise<Response> => {
	const url = new URL(`${apiBase}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`);
	url.searchParams.set("ref", config.branch);
	return fetch(url, {
		...init,
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${config.token}`,
			"X-GitHub-Api-Version": "2022-11-28",
			...(init?.body ? { "Content-Type": "application/json" } : {}),
			...(init?.headers || {}),
		},
	});
};

export const getGitHubFile = async (config: GitHubConfig, path: string): Promise<GitHubContent | null> => {
	const response = await request(config, path);
	if (response.status === 404) return null;
	if (!response.ok) throw new Error("github_read_failed");
	return response.json() as Promise<GitHubContent>;
};

const encodeContent = (content: string): string => btoa(unescape(encodeURIComponent(content)));

export const putGitHubFile = async (config: GitHubConfig, path: string, content: string, sha: string | undefined, message: string): Promise<GitHubCommit> => {
	const response = await request(config, path, {
		method: "PUT",
		body: JSON.stringify({ message, content: encodeContent(content), branch: config.branch, ...(sha ? { sha } : {}) }),
	});
	if (response.status === 409 || response.status === 422) throw new Error("github_conflict");
	if (!response.ok) throw new Error("github_write_failed");
	return response.json() as Promise<GitHubCommit>;
};
