// 站点设置服务：读取远端配置 → 解析为结构化值 → 暂存变更集 → 差异预览 → 批量发布。
// GitHub 上的配置文件始终是事实源；D1 只保存暂存状态、版本与已发布历史。
// 所有 SQL 均为静态字面量加占位符绑定；行类型用具名 type 声明。

import {
	applyGroupValues,
	CONFIG_GROUPS,
	getConfigGroup,
	parseGroupValues,
	validateGroupValues,
	type ConfigGroup,
	type FieldBinding,
	type JsonLikeValue,
} from "../config/registry";
import { first, run } from "../db";
import { ApiError } from "../errors";
import {
	commitGitHubFiles,
	decodeGitHubContent,
	getGitHubConfig,
	getGitHubFile,
	getGitHubHead,
} from "../github";
import { randomToken } from "../security";

export type ConfigStateRow = {
	config_key: string;
	file_path: string;
	version: number;
	github_blob_sha: string | null;
	commit_sha: string | null;
	staged_payload: string | null;
	staged_blob_sha: string | null;
	staged_by: string | null;
	staged_at: string | null;
	deployed_blob_sha: string | null;
	deployed_commit_sha: string | null;
	deployed_at: string | null;
	updated_at: string;
};

export type SettingsGroupStatus = {
	key: string;
	label: string;
	section: "content" | "settings";
	description: string;
	filePath: string;
	version: number;
	staged: boolean;
	stale: boolean;
	stagedAt: string | null;
	parseError: string | null;
	deployedCommitSha: string | null;
	deployedAt: string | null;
};

export type SettingsGroupDetail = SettingsGroupStatus & {
	values: Record<string, JsonLikeValue>;
	baseValues: Record<string, JsonLikeValue>;
	code: Record<string, string>;
	baseCode: Record<string, string>;
	fields: FieldBinding[];
	codeFiles: {
		id: string;
		path: string;
		label: string;
		help?: string;
		maxLength: number;
	}[];
};

export type SettingsPublishResult = {
	commitSha: string;
	published: { key: string; label: string; changed: string[] }[];
	unchanged: { key: string; label: string }[];
};

export type SettingsHistoryItem = {
	id: string;
	version: number;
	commitSha: string | null;
	createdAt: string;
};

export type SettingsDiff = {
	key: string;
	label: string;
	files: { path: string; before: string; after: string }[];
};

type SettingsEnv = {
	DB: D1Database;
	GITHUB_TOKEN?: string;
	GITHUB_OWNER?: string;
	GITHUB_REPO?: string;
	GITHUB_BRANCH?: string;
};

type StagedPayload = {
	values: Record<string, JsonLikeValue>;
	code?: Record<string, string>;
};

type PayloadHistoryRow = { payload: string };

type MaxVersionRow = { current: number };

type StagedCountRow = { staged: number };

type HistoryRow = {
	id: string;
	version: number;
	commit_sha: string | null;
	created_at: string;
};

const now = (): string => new Date().toISOString();

// Git blob sha（sha1 of "blob <len>\0content"），用于下次发布的乐观锁校验。
export const gitBlobSha = async (content: string): Promise<string> => {
	const bytes = new TextEncoder().encode(content);
	const prefix = new TextEncoder().encode("blob " + bytes.length + "\0");
	const payload = new Uint8Array(prefix.length + bytes.length);
	payload.set(prefix, 0);
	payload.set(bytes, prefix.length);
	const digest = await crypto.subtle.digest("SHA-1", payload);
	const hex: string[] = [];
	for (const byte of new Uint8Array(digest))
		hex.push(byte.toString(16).padStart(2, "0"));
	return hex.join("");
};

const requireGroup = (key: string): ConfigGroup => {
	const group = getConfigGroup(key);
	if (!group) throw new ApiError(404, "not_found", "配置分组不存在");
	return group;
};

const ensureState = async (
	env: SettingsEnv,
	group: ConfigGroup,
): Promise<ConfigStateRow> => {
	const existing = await first<ConfigStateRow>(
		env.DB,
		"SELECT config_key, file_path, version, github_blob_sha, commit_sha, staged_payload, staged_blob_sha, staged_by, staged_at, deployed_blob_sha, deployed_commit_sha, deployed_at, updated_at FROM admin_config_state WHERE config_key = ?",
		group.key,
	);
	if (existing) return existing;
	await run(
		env.DB,
		"INSERT OR IGNORE INTO admin_config_state (config_key, file_path, version, updated_at) VALUES (?, ?, 1, ?)",
		group.key,
		group.filePath,
		now(),
	);
	const created = await first<ConfigStateRow>(
		env.DB,
		"SELECT config_key, file_path, version, github_blob_sha, commit_sha, staged_payload, staged_blob_sha, staged_by, staged_at, deployed_blob_sha, deployed_commit_sha, deployed_at, updated_at FROM admin_config_state WHERE config_key = ?",
		group.key,
	);
	if (!created)
		throw new ApiError(500, "config_state_failed", "配置状态初始化失败");
	return created;
};

const requireGitHubConfig = (env: SettingsEnv) => {
	const config = getGitHubConfig(env);
	if (!config)
		throw new ApiError(503, "github_not_configured", "GitHub 集成未配置");
	return config;
};

const fetchRemoteFiles = async (
	env: SettingsEnv,
	group: ConfigGroup,
): Promise<{ files: Record<string, string>; shas: Record<string, string> }> => {
	const config = requireGitHubConfig(env);
	const paths = [
		group.filePath,
		...(group.codeFiles ?? []).map((file) => file.path),
	];
	const files: Record<string, string> = {};
	const shas: Record<string, string> = {};
	for (const path of paths) {
		const remote = await getGitHubFile(config, path);
		const content = decodeGitHubContent(remote);
		if (content === null)
			throw new ApiError(502, "github_read_failed", "配置文件内容无法解码");
		files[path] = content;
		shas[path] = remote.sha;
	}
	return { files, shas };
};

const safeParsePayload = (raw: string | null): StagedPayload | null => {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<StagedPayload>;
		if (!parsed.values || typeof parsed.values !== "object") return null;
		return { values: parsed.values, code: parsed.code ?? {} };
	} catch {
		return null;
	}
};

const toStatus = (
	group: ConfigGroup,
	state: ConfigStateRow,
	parseError: string | null,
	stale: boolean,
): SettingsGroupStatus => ({
	key: group.key,
	label: group.label,
	section: group.section,
	description: group.description,
	filePath: group.filePath,
	version: state.version,
	staged: Boolean(state.staged_payload),
	stale,
	stagedAt: state.staged_at,
	parseError,
	deployedCommitSha: state.deployed_commit_sha,
	deployedAt: state.deployed_at,
});

export const listSettingsGroups = async (
	env: SettingsEnv,
): Promise<SettingsGroupStatus[]> => {
	const statuses: SettingsGroupStatus[] = [];
	for (const group of CONFIG_GROUPS) {
		const state = await ensureState(env, group);
		// 列表不请求 GitHub；解析状态在进入详情时才暴露
		statuses.push(toStatus(group, state, null, false));
	}
	return statuses;
};

export const getSettingsGroup = async (
	env: SettingsEnv,
	key: string,
): Promise<SettingsGroupDetail> => {
	const group = requireGroup(key);
	const state = await ensureState(env, group);
	const { files, shas } = await fetchRemoteFiles(env, group);
	const mainSha = shas[group.filePath];
	let parseError: string | null = null;
	let baseValues: Record<string, JsonLikeValue> = {};
	try {
		baseValues = parseGroupValues(files[group.filePath] ?? "", group);
	} catch (cause) {
		parseError =
			cause instanceof Error ? cause.message : "配置文件解析失败，请检查最近的手工改动";
	}
	const staged = safeParsePayload(state.staged_payload);
	const stale = Boolean(state.staged_payload) && state.staged_blob_sha !== mainSha;
	const code: Record<string, string> = {};
	const baseCode: Record<string, string> = {};
	for (const codeFile of group.codeFiles ?? []) {
		baseCode[codeFile.id] = files[codeFile.path] ?? "";
		code[codeFile.id] =
			staged && typeof staged.code[codeFile.id] === "string"
				? staged.code[codeFile.id]
				: (files[codeFile.path] ?? "");
	}
	return {
		...toStatus(group, state, parseError, stale),
		values: staged ? staged.values : baseValues,
		baseValues,
		code,
		baseCode,
		fields: group.fields,
		codeFiles: (group.codeFiles ?? []).map((file) => ({
			id: file.id,
			path: file.path,
			label: file.label,
			help: file.help,
			maxLength: file.maxLength,
		})),
	};
};

export type StageSettingsInput = {
	key: string;
	values: Record<string, JsonLikeValue>;
	code?: Record<string, string>;
	expectedVersion: number;
};

export const stageSettingsGroup = async (
	env: SettingsEnv,
	input: StageSettingsInput,
	userId: string,
): Promise<SettingsGroupDetail> => {
	const group = requireGroup(input.key);
	const state = await ensureState(env, group);
	if (state.version !== input.expectedVersion)
		throw new ApiError(
			409,
			"config_version_conflict",
			"配置已被其他修改更新，请刷新后再保存",
		);
	const errors = validateGroupValues(group, input.values, input.code);
	if (Object.keys(errors).length > 0)
		throw new ApiError(422, "validation_failed", "配置校验失败", false, errors);
	const { shas } = await fetchRemoteFiles(env, group);
	await run(
		env.DB,
		"UPDATE admin_config_state SET staged_payload = ?, staged_blob_sha = ?, staged_by = ?, staged_at = ?, version = version + 1, updated_at = ? WHERE config_key = ?",
		JSON.stringify({ values: input.values, code: input.code ?? {} }),
		shas[group.filePath],
		userId,
		now(),
		now(),
		group.key,
	);
	return getSettingsGroup(env, group.key);
};

export const discardSettingsGroup = async (
	env: SettingsEnv,
	key: string,
): Promise<void> => {
	const group = requireGroup(key);
	const state = await ensureState(env, group);
	if (!state.staged_payload) return;
	await run(
		env.DB,
		"UPDATE admin_config_state SET staged_payload = NULL, staged_blob_sha = NULL, staged_by = NULL, staged_at = NULL, version = version + 1, updated_at = ? WHERE config_key = ?",
		now(),
		group.key,
	);
};

// 用历史版本的 payload 覆盖当前暂存（恢复 = 暂存旧值，再走正常差异与发布）。
export const restoreSettingsVersion = async (
	env: SettingsEnv,
	key: string,
	historyId: string,
	userId: string,
): Promise<SettingsGroupDetail> => {
	const group = requireGroup(key);
	const history = await first<PayloadHistoryRow>(
		env.DB,
		"SELECT payload FROM admin_config_history WHERE id = ? AND config_key = ?",
		historyId,
		key,
	);
	if (!history) throw new ApiError(404, "not_found", "历史版本不存在");
	const payload = safeParsePayload(history.payload);
	if (!payload)
		throw new ApiError(409, "config_history_invalid", "历史版本数据无法恢复");
	const state = await ensureState(env, group);
	const { shas } = await fetchRemoteFiles(env, group);
	await run(
		env.DB,
		"UPDATE admin_config_state SET staged_payload = ?, staged_blob_sha = ?, staged_by = ?, staged_at = ?, version = version + 1, updated_at = ? WHERE config_key = ?",
		JSON.stringify({ values: payload.values, code: payload.code ?? {} }),
		shas[group.filePath],
		userId,
		now(),
		now(),
		group.key,
	);
	return getSettingsGroup(env, group.key);
};

export const diffSettingsGroup = async (
	env: SettingsEnv,
	key: string,
): Promise<SettingsDiff> => {
	const group = requireGroup(key);
	const state = await ensureState(env, group);
	const staged = safeParsePayload(state.staged_payload);
	if (!staged)
		throw new ApiError(409, "content_not_modified", "该分组没有待发布的修改");
	const { files } = await fetchRemoteFiles(env, group);
	const result = applyGroupValues(
		files[group.filePath] ?? "",
		group,
		staged.values,
	);
	const nextFiles: SettingsDiff["files"] = [];
	if (result.content !== null)
		nextFiles.push({
			path: group.filePath,
			before: files[group.filePath] ?? "",
			after: result.content,
		});
	for (const codeFile of group.codeFiles ?? []) {
		const next = staged.code[codeFile.id];
		if (typeof next !== "string") continue;
		if (next === files[codeFile.path]) continue;
		nextFiles.push({
			path: codeFile.path,
			before: files[codeFile.path] ?? "",
			after: next,
		});
	}
	return { key: group.key, label: group.label, files: nextFiles };
};

export const publishSettings = async (
	env: SettingsEnv,
	keys: string[],
	userId: string,
): Promise<SettingsPublishResult> => {
	const selected =
		keys.length === 0 ? CONFIG_GROUPS : keys.map((key) => requireGroup(key));
	requireGitHubConfig(env);
	const stagedGroups: {
		group: ConfigGroup;
		state: ConfigStateRow;
		staged: StagedPayload;
	}[] = [];
	for (const group of selected) {
		const state = await ensureState(env, group);
		const staged = safeParsePayload(state.staged_payload);
		if (!state.staged_payload || !staged) continue;
		stagedGroups.push({ group, state, staged });
	}
	const changes: { path: string; content: string; expectedBlobSha: string }[] = [];
	const groupOutputs: {
		group: ConfigGroup;
		payload: StagedPayload;
		nextShas: Record<string, string>;
	}[] = [];
	const published: { key: string; label: string; changed: string[] }[] = [];
	const unchanged: { key: string; label: string }[] = [];
	for (const entry of stagedGroups) {
		const { files, shas } = await fetchRemoteFiles(env, entry.group);
		if (entry.state.staged_blob_sha !== shas[entry.group.filePath])
			throw new ApiError(
				409,
				"config_file_changed",
				"配置文件已被其他人修改，请刷新分组后重新保存",
			);
		const result = applyGroupValues(
			files[entry.group.filePath] ?? "",
			entry.group,
			entry.staged.values,
		);
		const nextShas: Record<string, string> = { ...shas };
		if (result.content !== null)
			nextShas[entry.group.filePath] = await gitBlobSha(result.content);
		let codeChanged = false;
		for (const codeFile of entry.group.codeFiles ?? []) {
			const next = entry.staged.code[codeFile.id];
			if (typeof next !== "string") continue;
			if (next === files[codeFile.path]) continue;
			nextShas[codeFile.path] = await gitBlobSha(next);
			codeChanged = true;
		}
		if (result.content !== null) {
			changes.push({
				path: entry.group.filePath,
				content: result.content,
				expectedBlobSha: shas[entry.group.filePath],
			});
		}
		for (const codeFile of entry.group.codeFiles ?? []) {
			const next = entry.staged.code[codeFile.id];
			if (typeof next !== "string") continue;
			if (next === files[codeFile.path]) continue;
			changes.push({
				path: codeFile.path,
				content: next,
				expectedBlobSha: shas[codeFile.path],
			});
		}
		if (result.content === null && !codeChanged) {
			// 暂存内容与远端一致（例如远端已被其他途径更新）：清理暂存，
			// 避免留下永远发布不出去的空变更集
			await run(
				env.DB,
				"UPDATE admin_config_state SET staged_payload = NULL, staged_blob_sha = NULL, staged_by = NULL, staged_at = NULL, version = version + 1, updated_at = ? WHERE config_key = ?",
				now(),
				entry.group.key,
			);
			unchanged.push({ key: entry.group.key, label: entry.group.label });
			continue;
		}
		groupOutputs.push({ group: entry.group, payload: entry.staged, nextShas });
		published.push({
			key: entry.group.key,
			label: entry.group.label,
			changed: [...result.changed],
		});
	}
	if (changes.length === 0) return { commitSha: "", published: [], unchanged };
	const config = requireGitHubConfig(env);
	const head = await getGitHubHead(config);
	const commit = await commitGitHubFiles(
		config,
		changes,
		head,
		"chore(admin): publish site settings",
	);
	const timestamp = now();
	for (const entry of groupOutputs) {
		const mainSha = entry.nextShas[entry.group.filePath];
		await run(
			env.DB,
			"UPDATE admin_config_state SET staged_payload = NULL, staged_blob_sha = NULL, staged_by = NULL, staged_at = NULL, version = version + 1, github_blob_sha = ?, commit_sha = ?, deployed_blob_sha = ?, deployed_commit_sha = ?, deployed_at = ?, updated_at = ? WHERE config_key = ?",
			mainSha,
			commit.commitSha,
			mainSha,
			commit.commitSha,
			timestamp,
			timestamp,
			entry.group.key,
		);
		const maxRow = await first<MaxVersionRow>(
			env.DB,
			"SELECT COALESCE(MAX(version), 0) AS current FROM admin_config_history WHERE config_key = ?",
			entry.group.key,
		);
		const nextVersion = (maxRow?.current ?? 0) + 1;
		await run(
			env.DB,
			"INSERT INTO admin_config_history (id, config_key, version, payload, file_path, blob_sha, commit_sha, applied_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			randomToken(16),
			entry.group.key,
			nextVersion,
			JSON.stringify({
				values: entry.payload.values,
				code: entry.payload.code ?? {},
			}),
			entry.group.filePath,
			mainSha,
			commit.commitSha,
			userId,
			timestamp,
		);
	}
	return { commitSha: commit.commitSha, published, unchanged };
};

export const settingsHistory = async (
	env: SettingsEnv,
	key: string,
): Promise<SettingsHistoryItem[]> => {
	requireGroup(key);
	const result = await env.DB
		.prepare(
			"SELECT id, version, commit_sha, created_at FROM admin_config_history WHERE config_key = ? ORDER BY version DESC LIMIT 50",
		)
		.bind(key)
		.all<HistoryRow>();
	return (result.results ?? []).map((row) => ({
		id: row.id,
		version: row.version,
		commitSha: row.commit_sha,
		createdAt: row.created_at,
	}));
};

export const stagedSettingsCount = async (
	env: SettingsEnv,
): Promise<number> => {
	const row = await first<StagedCountRow>(
		env.DB,
		"SELECT COUNT(*) AS staged FROM admin_config_state WHERE staged_payload IS NOT NULL",
	);
	return row?.staged ?? 0;
};
