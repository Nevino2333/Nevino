// 仪表盘聚合：内容、媒体、发布与安全的概览计数，不暴露敏感明细。

import { CONFIG_GROUPS } from "../config/registry";
import { getGitHubConfig } from "../github";

export type OverviewEnv = {
	DB: D1Database;
	GITHUB_TOKEN?: string;
	GITHUB_OWNER?: string;
	GITHUB_REPO?: string;
	GITHUB_BRANCH?: string;
	MEDIA_BUCKET?: unknown;
};

export type PostStateCounts = {
	published: number;
	drafts: number;
	withdrawn: number;
	total: number;
};

export type PublishingOverview = {
	activeTasks: number;
	reconciliationRequired: number;
	failedOperations: number;
	lastDeployedAt: string | null;
};

export type RecentAuditItem = {
	id: string;
	action: string;
	ip: string;
	result: string;
	resourceType: string;
	resourceId: string;
	createdAt: string;
};

export type AdminOverview = {
	posts: PostStateCounts;
	mediaCount: number;
	mediaAvailable: boolean;
	pages: { total: number; staged: number };
	settings: { totalGroups: number; stagedGroups: number };
	publishing: PublishingOverview;
	recentAudit: RecentAuditItem[];
	githubConfigured: boolean;
};

type DraftStateRow = {
	publication_state: string | null;
	count: number;
};

type CountRow = {
	total: number;
};

type AuditRow = {
	id: string;
	action: string;
	ip: string;
	metadata: string | null;
	created_at: string;
};

const parseMetadata = (raw: string | null): { result?: string; resourceType?: string; resourceId?: string } => {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as {
			result?: string;
			resourceType?: string;
			resourceId?: string;
		};
		return {
			result: parsed.result ?? "",
			resourceType: parsed.resourceType ?? "",
			resourceId: parsed.resourceId ?? "",
		};
	} catch {
		return {};
	}
};

export const buildOverview = async (env: OverviewEnv): Promise<AdminOverview> => {
	const draftStateResult = await env.DB
		.prepare(
			"SELECT publication_state, COUNT(*) AS count FROM admin_drafts WHERE deleted_at IS NULL GROUP BY publication_state",
		)
		.all<DraftStateRow>();
	const posts: PostStateCounts = {
		published: 0,
		drafts: 0,
		withdrawn: 0,
		total: 0,
	};
	for (const row of draftStateResult.results ?? []) {
		const count = row.count ?? 0;
		posts.total += count;
		if (row.publication_state === "published") posts.published += count;
		else if (row.publication_state === "withdrawn") posts.withdrawn += count;
		else posts.drafts += count;
	}

	const mediaRow = await env.DB.prepare(
		"SELECT COUNT(*) AS total FROM media_assets",
	).first<CountRow>();

	const pageTotals = await env.DB.prepare(
		"SELECT COUNT(*) AS total, SUM(CASE WHEN staged_content IS NOT NULL THEN 1 ELSE 0 END) AS staged FROM admin_pages",
	).first<{ total: number; staged: number | null }>();

	const stagedConfigRow = await env.DB.prepare(
		"SELECT COUNT(*) AS total FROM admin_config_state WHERE staged_payload IS NOT NULL",
	).first<CountRow>();

	const activeTaskRow = await env.DB.prepare(
		"SELECT COUNT(*) AS total FROM admin_publish_tasks WHERE status IN ('pending', 'awaiting_deploy')",
	).first<CountRow>();

	const reconcileTaskRow = await env.DB.prepare(
		"SELECT COUNT(*) AS total FROM admin_publish_tasks WHERE status = 'reconciliation_required'",
	).first<CountRow>();

	const failedOperationRow = await env.DB.prepare(
		"SELECT COUNT(*) AS total FROM admin_content_operations WHERE status IN ('failed', 'reconciliation_required')",
	).first<CountRow>();

	const lastPageDeploy = await env.DB.prepare(
		"SELECT MAX(COALESCE(deployed_at, '')) AS total FROM admin_pages",
	).first<{ total: string | null }>();

	const lastConfigDeploy = await env.DB.prepare(
		"SELECT MAX(COALESCE(deployed_at, '')) AS total FROM admin_config_state",
	).first<{ total: string | null }>();

	const lastTaskDeploy = await env.DB.prepare(
		"SELECT MAX(COALESCE(updated_at, '')) AS total FROM admin_publish_tasks WHERE status = 'completed'",
	).first<{ total: string | null }>();

	const auditResult = await env.DB.prepare(
		"SELECT id, action, ip, metadata, created_at FROM admin_audit ORDER BY created_at DESC LIMIT 12",
	).all<AuditRow>();

	const candidates = [
		lastPageDeploy?.total ?? "",
		lastConfigDeploy?.total ?? "",
		lastTaskDeploy?.total ?? "",
	];
	const lastDeployedAt = candidates.sort().at(-1) || null;

	let githubConfigured = false;
	try {
		githubConfigured = getGitHubConfig(env) !== null;
	} catch {
		githubConfigured = false;
	}

	return {
		posts,
		mediaCount: mediaRow?.total ?? 0,
		mediaAvailable: env.MEDIA_BUCKET !== undefined,
		pages: {
			total: pageTotals?.total ?? 0,
			staged: pageTotals?.staged ?? 0,
		},
		settings: {
			totalGroups: CONFIG_GROUPS.length,
			stagedGroups: stagedConfigRow?.total ?? 0,
		},
		publishing: {
			activeTasks: activeTaskRow?.total ?? 0,
			reconciliationRequired: reconcileTaskRow?.total ?? 0,
			failedOperations: failedOperationRow?.total ?? 0,
			lastDeployedAt,
		},
		recentAudit: (auditResult.results ?? []).map((row) => {
			const metadata = parseMetadata(row.metadata);
			return {
				id: row.id,
				action: row.action,
				ip: row.ip,
				result: metadata.result ?? "",
				resourceType: metadata.resourceType ?? "",
				resourceId: metadata.resourceId ?? "",
				createdAt: row.created_at,
			};
		}),
		githubConfigured,
	};
};
