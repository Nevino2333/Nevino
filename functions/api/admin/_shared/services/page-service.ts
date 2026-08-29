// 独立页面服务：about/guestbook/friends.mdx 等仓库 spec 内容的在线编辑。
// 流程与文章一致：GitHub 为事实源，D1 保存当前绑定、暂存修改与修订历史。

import { first, run } from "../db";
import { ApiError } from "../errors";
import {
	decodeGitHubContent,
	getGitHubConfig,
	getGitHubFile,
	getGitHubFileAtRef,
	listGitHubFileHistory,
	updateGitHubFile,
	type GitHubHistoryItem,
} from "../github";
import { createLineDiff, type DiffLine } from "./line-diff";
import { randomToken, sha256 } from "../security";

export type SpecPageDef = {
	key: string;
	label: string;
	description: string;
	filePath: string;
};

// 与 allowed-paths.ts 中的 SPEC_PAGE_PATHS 保持一致
export const SPEC_PAGES: SpecPageDef[] = [
	{
		key: "about",
		label: "关于",
		description: "关于页面正文（src/content/spec/about.md）",
		filePath: "src/content/spec/about.md",
	},
	{
		key: "guestbook",
		label: "留言板",
		description: "留言板页面说明（src/content/spec/guestbook.md）",
		filePath: "src/content/spec/guestbook.md",
	},
	{
		key: "friends_page",
		label: "友链页自定义内容",
		description: "友链页面下方的自定义内容（src/content/spec/friends.mdx）",
		filePath: "src/content/spec/friends.mdx",
	},
];

const MAX_PAGE_CONTENT = 500_000;

export type SpecPageRow = {
	page_key: string;
	github_path: string;
	github_blob_sha: string | null;
	commit_sha: string | null;
	version: number;
	content: string;
	staged_content: string | null;
	staged_blob_sha: string | null;
	staged_at: string | null;
	deployed_blob_sha: string | null;
	deployed_commit_sha: string | null;
	deployed_at: string | null;
	deleted_at: string | null;
	created_at: string;
	updated_at: string;
};

export type SpecPageStatus = {
	key: string;
	label: string;
	description: string;
	filePath: string;
	version: number;
	staged: boolean;
	stagedAt: string | null;
	deployedCommitSha: string | null;
	deployedAt: string | null;
};

export type SpecPageDetail = SpecPageStatus & {
	content: string;
	baseContent: string;
	stale: boolean;
};

export type SpecPageHistoryItem =
	| {
			type: "commit";
			id: string;
			message: string;
			authorName: string;
			date: string;
	  }
	| {
			type: "revision";
			id: string;
			source: string;
			version: number;
			date: string;
	  };

export type SpecPageHistoryDetail = {
	type: "commit" | "revision";
	id: string;
	date: string;
	source?: string;
	message?: string;
	diff: DiffLine[];
	after: string;
};

type PageEnv = {
	DB: D1Database;
	GITHUB_TOKEN?: string;
	GITHUB_OWNER?: string;
	GITHUB_REPO?: string;
	GITHUB_BRANCH?: string;
};

type RevisionRow = {
	id: string;
	page_key: string;
	version: number;
	source: string;
	content: string;
	content_sha256: string;
	blob_sha: string | null;
	commit_sha: string | null;
	created_at: string;
};

const now = (): string => new Date().toISOString();

const requirePageDef = (key: string): SpecPageDef => {
	const def = SPEC_PAGES.find((page) => page.key === key);
	if (!def) throw new ApiError(404, "not_found", "页面不存在");
	return def;
};

const requireGitHubConfig = (env: PageEnv) => {
	const config = getGitHubConfig(env);
	if (!config)
		throw new ApiError(503, "github_not_configured", "GitHub 集成未配置");
	return config;
};

const ensurePageRow = async (
	env: PageEnv,
	def: SpecPageDef,
): Promise<SpecPageRow> => {
	const existing = await first<SpecPageRow>(
		env.DB,
		"SELECT page_key, github_path, github_blob_sha, commit_sha, version, content, staged_content, staged_blob_sha, staged_at, deployed_blob_sha, deployed_commit_sha, deployed_at, deleted_at, created_at, updated_at FROM admin_pages WHERE page_key = ?",
		def.key,
	);
	if (existing) return existing;
	await run(
		env.DB,
		"INSERT OR IGNORE INTO admin_pages (page_key, github_path, version, content, created_at, updated_at) VALUES (?, ?, 1, '', ?, ?)",
		def.key,
		def.filePath,
		now(),
		now(),
	);
	const created = await first<SpecPageRow>(
		env.DB,
		"SELECT page_key, github_path, github_blob_sha, commit_sha, version, content, staged_content, staged_blob_sha, staged_at, deployed_blob_sha, deployed_commit_sha, deployed_at, deleted_at, created_at, updated_at FROM admin_pages WHERE page_key = ?",
		def.key,
	);
	if (!created) throw new ApiError(500, "page_state_failed", "页面状态初始化失败");
	return created;
};

const fetchRemotePage = async (
	env: PageEnv,
	def: SpecPageDef,
): Promise<{ content: string; blobSha: string }> => {
	const config = requireGitHubConfig(env);
	const remote = await getGitHubFile(config, def.filePath);
	const content = decodeGitHubContent(remote);
	if (content === null)
		throw new ApiError(502, "github_read_failed", "页面内容无法解码");
	return { content, blobSha: remote.sha };
};

const toStatus = (def: SpecPageDef, row: SpecPageRow): SpecPageStatus => ({
	key: def.key,
	label: def.label,
	description: def.description,
	filePath: def.filePath,
	version: row.version,
	staged: Boolean(row.staged_content),
	stagedAt: row.staged_at,
	deployedCommitSha: row.deployed_commit_sha,
	deployedAt: row.deployed_at,
});

export const listSpecPages = async (
	env: PageEnv,
): Promise<SpecPageStatus[]> => {
	const statuses: SpecPageStatus[] = [];
	for (const def of SPEC_PAGES) {
		const row = await ensurePageRow(env, def);
		statuses.push(toStatus(def, row));
	}
	return statuses;
};

// 拉取远端内容并同步本地绑定；远端变化时丢弃基于旧版本的暂存，避免覆盖他人改动。
const syncPageRow = async (
	env: PageEnv,
	def: SpecPageDef,
	row: SpecPageRow,
	remoteContent: string,
	remoteSha: string,
): Promise<SpecPageRow> => {
	if (row.github_blob_sha === remoteSha) return row;
	const stagedOutdated =
		row.staged_content !== null && row.staged_blob_sha !== remoteSha;
	const wasEmpty = row.github_blob_sha === null;
	await run(
		env.DB,
		"UPDATE admin_pages SET content = ?, staged_content = CASE WHEN ? THEN NULL ELSE staged_content END, staged_blob_sha = CASE WHEN ? THEN NULL ELSE staged_blob_sha END, staged_at = CASE WHEN ? THEN NULL ELSE staged_at END, github_blob_sha = ?, version = version + 1, updated_at = ? WHERE page_key = ?",
		remoteContent,
		stagedOutdated ? 1 : 0,
		stagedOutdated ? 1 : 0,
		stagedOutdated ? 1 : 0,
		remoteSha,
		now(),
		def.key,
	);
	if (wasEmpty) {
		await run(
			env.DB,
			"INSERT INTO admin_page_revisions (id, page_key, version, source, content, content_sha256, blob_sha, created_at) VALUES (?, ?, 0, 'import', ?, ?, ?, ?)",
			randomToken(16),
			def.key,
			remoteContent,
			await sha256(remoteContent),
			remoteSha,
			now(),
		);
	}
	const refreshed = await first<SpecPageRow>(
		env.DB,
		"SELECT page_key, github_path, github_blob_sha, commit_sha, version, content, staged_content, staged_blob_sha, staged_at, deployed_blob_sha, deployed_commit_sha, deployed_at, deleted_at, created_at, updated_at FROM admin_pages WHERE page_key = ?",
		def.key,
	);
	if (!refreshed) throw new ApiError(500, "page_state_failed", "页面状态读取失败");
	return refreshed;
};

export const getSpecPage = async (
	env: PageEnv,
	key: string,
): Promise<SpecPageDetail> => {
	const def = requirePageDef(key);
	const row = await ensurePageRow(env, def);
	const remote = await fetchRemotePage(env, def);
	const synced = await syncPageRow(env, def, row, remote.content, remote.blobSha);
	const staged = synced.staged_content;
	return {
		...toStatus(def, synced),
		content: staged ?? synced.content,
		baseContent: synced.content,
		stale: staged !== null && synced.staged_blob_sha !== remote.blobSha,
	};
};

export const stageSpecPage = async (
	env: PageEnv,
	key: string,
	content: string,
	expectedVersion: number,
	userId: string,
): Promise<SpecPageDetail> => {
	const def = requirePageDef(key);
	if (typeof content !== "string")
		throw new ApiError(422, "validation_failed", "页面内容必须为文本");
	if (content.length > MAX_PAGE_CONTENT)
		throw new ApiError(422, "validation_failed", "页面内容超出长度限制");
	const row = await ensurePageRow(env, def);
	if (row.version !== expectedVersion)
		throw new ApiError(
			409,
			"page_version_conflict",
			"页面已被其他修改更新，请刷新后再保存",
		);
	const remote = await fetchRemotePage(env, def);
	const synced = await syncPageRow(env, def, row, remote.content, remote.blobSha);
	if (synced.version !== expectedVersion)
		throw new ApiError(
			409,
			"page_version_conflict",
			"页面已被其他修改更新，请刷新后再保存",
		);
	await run(
		env.DB,
		"UPDATE admin_pages SET staged_content = ?, staged_blob_sha = ?, staged_at = ?, version = version + 1, updated_at = ? WHERE page_key = ?",
		content,
		remote.blobSha,
		now(),
		now(),
		def.key,
	);
	await pruneRevisions(env, def.key);
	await run(
		env.DB,
		"INSERT INTO admin_page_revisions (id, page_key, version, source, content, content_sha256, blob_sha, created_at) VALUES (?, ?, (SELECT COALESCE(MAX(version), 0) + 1 FROM admin_page_revisions WHERE page_key = ?), 'save', ?, ?, ?, ?)",
		randomToken(16),
		def.key,
		def.key,
		content,
		await sha256(content),
		remote.blobSha,
		now(),
	);
	void userId;
	return getSpecPage(env, def.key);
};

const pruneRevisions = async (env: PageEnv, pageKey: string): Promise<void> => {
	await run(
		env.DB,
		"DELETE FROM admin_page_revisions WHERE page_key = ? AND id NOT IN (SELECT id FROM admin_page_revisions WHERE page_key = ? ORDER BY created_at DESC LIMIT 50)",
		pageKey,
		pageKey,
	);
};

export const discardSpecPage = async (
	env: PageEnv,
	key: string,
): Promise<void> => {
	const def = requirePageDef(key);
	const row = await ensurePageRow(env, def);
	if (!row.staged_content) return;
	await run(
		env.DB,
		"UPDATE admin_pages SET staged_content = NULL, staged_blob_sha = NULL, staged_at = NULL, version = version + 1, updated_at = ? WHERE page_key = ?",
		now(),
		def.key,
	);
};

export const publishSpecPage = async (
	env: PageEnv,
	key: string,
	userId: string,
): Promise<SpecPageDetail> => {
	const def = requirePageDef(key);
	const row = await ensurePageRow(env, def);
	if (!row.staged_content)
		throw new ApiError(409, "content_not_modified", "该页面没有待发布的修改");
	if (row.staged_blob_sha === null)
		throw new ApiError(409, "page_stage_invalid", "暂存数据缺少基线版本");
	const config = requireGitHubConfig(env);
	const remote = await getGitHubFile(config, def.filePath);
	if (remote.sha !== row.staged_blob_sha)
		throw new ApiError(
			409,
			"page_file_changed",
			"页面文件已被其他人修改，请刷新后重新保存",
		);
	const content = row.staged_content;
	const commit = await updateGitHubFile(
		config,
		def.filePath,
		content,
		remote.sha,
		"feat(admin): update page " + def.filePath,
	);
	const timestamp = now();
	await run(
		env.DB,
		"UPDATE admin_pages SET content = ?, staged_content = NULL, staged_blob_sha = NULL, staged_at = NULL, version = version + 1, github_blob_sha = ?, commit_sha = ?, deployed_blob_sha = ?, deployed_commit_sha = ?, deployed_at = ?, updated_at = ? WHERE page_key = ?",
		content,
		commit.content.sha,
		commit.commit.sha,
		commit.content.sha,
		commit.commit.sha,
		timestamp,
		timestamp,
		def.key,
	);
	await run(
		env.DB,
		"INSERT INTO admin_page_revisions (id, page_key, version, source, content, content_sha256, blob_sha, commit_sha, created_at) VALUES (?, ?, (SELECT COALESCE(MAX(version), 0) + 1 FROM admin_page_revisions WHERE page_key = ?), 'publish', ?, ?, ?, ?, ?)",
		randomToken(16),
		def.key,
		def.key,
		content,
		await sha256(content),
		commit.content.sha,
		commit.commit.sha,
		timestamp,
	);
	void userId;
	return getSpecPage(env, def.key);
};

export const specPageHistory = async (
	env: PageEnv,
	key: string,
): Promise<SpecPageHistoryItem[]> => {
	const def = requirePageDef(key);
	const config = requireGitHubConfig(env);
	let commits: GitHubHistoryItem[] = [];
	try {
		commits = await listGitHubFileHistory(config, def.filePath, 30);
	} catch (cause) {
		if (!(cause instanceof ApiError) || cause.code !== "github_not_found")
			throw cause;
	}
	const revisionResult = await env.DB
		.prepare(
			"SELECT id, page_key, version, source, content, content_sha256, blob_sha, commit_sha, created_at FROM admin_page_revisions WHERE page_key = ? ORDER BY created_at DESC LIMIT 30",
		)
		.bind(def.key)
		.all<RevisionRow>();
	const items: SpecPageHistoryItem[] = commits.map((commit) => ({
		type: "commit" as const,
		id: commit.sha,
		message: commit.message,
		authorName: commit.authorName,
		date: commit.authorDate,
	}));
	for (const row of revisionResult.results ?? []) {
		items.push({
			type: "revision" as const,
			id: row.id,
			source: row.source,
			version: row.version,
			date: row.created_at,
		});
	}
	return items;
};

export const specPageHistoryDetail = async (
	env: PageEnv,
	key: string,
	record: string,
): Promise<SpecPageHistoryDetail> => {
	const def = requirePageDef(key);
	const row = await ensurePageRow(env, def);
	const commitShaPattern = /^[0-9a-f]{40}$/;
	if (commitShaPattern.test(record)) {
		const config = requireGitHubConfig(env);
		const remote = await getGitHubFileAtRef(config, def.filePath, record);
		const content = decodeGitHubContent(remote);
		if (content === null)
			throw new ApiError(502, "github_read_failed", "提交内容无法解码");
		return {
			type: "commit",
			id: record,
			date: "",
			message: "GitHub 提交 " + record.slice(0, 7),
			after: content,
			diff: createLineDiff(row.content, content),
		};
	}
	const revision = await first<RevisionRow>(
		env.DB,
		"SELECT id, page_key, version, source, content, content_sha256, blob_sha, commit_sha, created_at FROM admin_page_revisions WHERE id = ? AND page_key = ?",
		record,
		def.key,
	);
	if (!revision) throw new ApiError(404, "not_found", "历史记录不存在");
	return {
		type: "revision",
		id: revision.id,
		date: revision.created_at,
		source: revision.source,
		after: revision.content,
		diff: createLineDiff(row.content, revision.content),
	};
};

// 把历史版本内容暂存为当前修改（恢复 = 暂存 + 正常发布）。
export const restoreSpecPageRevision = async (
	env: PageEnv,
	key: string,
	record: string,
	userId: string,
): Promise<SpecPageDetail> => {
	const def = requirePageDef(key);
	const revision = await first<RevisionRow>(
		env.DB,
		"SELECT id, page_key, version, source, content, content_sha256, blob_sha, commit_sha, created_at FROM admin_page_revisions WHERE id = ? AND page_key = ?",
		record,
		def.key,
	);
	if (!revision) throw new ApiError(404, "not_found", "历史记录不存在");
	const detail = await getSpecPage(env, def.key);
	return stageSpecPage(env, def.key, revision.content, detail.version, userId);
};

export const specPageStatuses = SPEC_PAGES.map((page) => ({
	key: page.key,
	label: page.label,
}));
