import type { PublishTaskDto } from "../contracts";
import { ApiError } from "../errors";
import { githubPathForDraft, isAllowedGitHubPath } from "../github";
import { toMarkdown, validateMarkdown } from "../markdown";
import type { ContentRevisionRow, DraftRow, PublishTaskRow } from "../types";
import { publicationStateOf, workspaceStateOf } from "./content-service";
import { decidePublishTarget } from "./publish-target";

export interface PublishDraftRepository {
	get(id: string): Promise<DraftRow | null>;
	bindPublished(
		id: string,
		expectedVersion: number,
		path: string,
		blobSha: string,
		commitSha: string,
		now: string,
	): Promise<boolean>;
}

export interface PublishRevisionStore {
	create(row: ContentRevisionRow): Promise<void>;
}

export interface PublishTaskStore {
	findByIdempotencyKey(key: string): Promise<PublishTaskRow | null>;
	findActiveByDraftId(draftId: string): Promise<PublishTaskRow | null>;
	get(id: string): Promise<PublishTaskRow | null>;
	create(row: PublishTaskRow): Promise<PublishTaskRow>;
	claim(id: string, now: string): Promise<boolean>;
	recordGitHubCommit(
		id: string,
		blobSha: string,
		commitSha: string,
		now: string,
	): Promise<boolean>;
	markReconciliationRequired(
		id: string,
		fromStatus: PublishTaskRow["status"],
		blobSha: string,
		commitSha: string,
		errorCode: string,
		now: string,
	): Promise<boolean>;
	markAwaitingDeploy(
		id: string,
		fromStatus: PublishTaskRow["status"],
		now: string,
	): Promise<boolean>;
	markFailed(
		id: string,
		fromStatus: PublishTaskRow["status"],
		status: "validation_failed" | "content_conflict" | "submit_failed",
		errorCode: string,
		now: string,
	): Promise<boolean>;
}

export interface PublishGitHubGateway {
	getFile(
		path: string,
	): Promise<{ sha: string; content: string | null } | null>;
	createFile(
		path: string,
		content: string,
		message: string,
	): Promise<{ blobSha: string; commitSha: string }>;
	updateFile(
		path: string,
		content: string,
		expectedSha: string,
		message: string,
	): Promise<{ blobSha: string; commitSha: string }>;
}

type PublishInput = {
	draftId: string;
	userId: string;
	idempotencyKey: string;
	expectedVersion: number;
};

type Dependencies = {
	drafts: PublishDraftRepository;
	tasks: PublishTaskStore;
	revisions?: PublishRevisionStore;
	github: PublishGitHubGateway;
	now?: () => string;
	newId?: () => string;
};

const sha256 = async (value: string): Promise<string> => {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
};

const markdownForDraft = (draft: DraftRow): string => {
	let tags: string[];
	try {
		const value: unknown = JSON.parse(draft.tags_json);
		if (!Array.isArray(value) || !value.every((tag) => typeof tag === "string"))
			throw new Error("invalid_tags");
		tags = value;
	} catch {
		throw new ApiError(422, "markdown_invalid", "Markdown 无效");
	}
	return toMarkdown(
		{
			slug: draft.slug,
			title: draft.title,
			published: draft.published,
			updated: draft.updated ?? undefined,
			description: draft.description,
			aiSummary: draft.ai_summary,
			image: draft.image,
			tags,
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
		true,
	);
};

export const toPublishTaskDto = (row: PublishTaskRow): PublishTaskDto => ({
	id: row.id,
	draftId: row.draft_id,
	expectedVersion: row.expected_version,
	targetPath: row.target_path,
	status: row.status,
	attempts: row.attempts,
	githubBlobSha: row.github_blob_sha,
	githubCommitSha: row.github_commit_sha,
	errorCode: row.error_code,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
	completedAt: row.completed_at,
});

export class PublishService {
	private readonly now: () => string;
	private readonly newId: () => string;

	constructor(private readonly dependencies: Dependencies) {
		this.now = dependencies.now ?? (() => new Date().toISOString());
		this.newId = dependencies.newId ?? (() => crypto.randomUUID());
	}

	async getTask(id: string): Promise<PublishTaskDto> {
		const task = await this.dependencies.tasks.get(id);
		if (!task) throw new ApiError(404, "not_found", "发布任务不存在");
		return toPublishTaskDto(task);
	}

	async publish(input: PublishInput): Promise<PublishTaskDto> {
		const existing = await this.dependencies.tasks.findByIdempotencyKey(
			input.idempotencyKey,
		);
		if (existing) {
			if (
				existing.draft_id !== input.draftId ||
				existing.user_id !== input.userId ||
				existing.expected_version !== input.expectedVersion
			)
				throw new ApiError(
					409,
					"idempotency_key_conflict",
					"幂等键已用于其他发布请求",
				);
			return toPublishTaskDto(existing);
		}
		const active = await this.dependencies.tasks.findActiveByDraftId(
			input.draftId,
		);
		if (active)
			throw new ApiError(
				409,
				"publish_already_requested",
				"草稿已有未结束的发布任务",
			);
		const draft = await this.dependencies.drafts.get(input.draftId);
		if (!draft) throw new ApiError(404, "not_found", "草稿不存在");
		if (draft.version !== input.expectedVersion)
			throw new ApiError(
				409,
				"content_version_conflict",
				"草稿已被其他请求修改",
			);
		if (
			publicationStateOf(draft) === "published" &&
			workspaceStateOf(draft) === "clean"
		)
			throw new ApiError(409, "content_not_modified", "文章没有待发布修订");
		const path =
			publicationStateOf(draft) === "published" && draft.github_path
				? draft.github_path
				: githubPathForDraft(draft);
		if (!isAllowedGitHubPath(path))
			throw new ApiError(422, "path_not_allowed", "发布路径不受允许");
		const markdown = markdownForDraft(draft);
		if (!validateMarkdown(markdown))
			throw new ApiError(422, "markdown_invalid", "Markdown 无效");
		const now = this.now();
		if (this.dependencies.revisions)
			await this.dependencies.revisions.create({
				id: this.newId(),
				draft_id: draft.id,
				content_id: draft.content_id,
				version: draft.version,
				source: "publish",
				title: draft.title,
				slug: draft.slug,
				markdown,
				content_sha256: await sha256(markdown),
				github_blob_sha: draft.github_sha,
				github_commit_sha: draft.deployed_commit_sha ?? draft.commit_sha,
				created_by: input.userId,
				created_at: now,
			});
		const task: PublishTaskRow = {
			id: this.newId(),
			idempotency_key: input.idempotencyKey,
			draft_id: draft.id,
			user_id: input.userId,
			expected_version: input.expectedVersion,
			target_path: path,
			content_sha256: await sha256(markdown),
			status: "pending",
			attempts: 0,
			github_blob_sha: null,
			github_commit_sha: null,
			error_code: null,
			error_detail: null,
			created_at: now,
			updated_at: now,
			completed_at: null,
		};
		try {
			await this.dependencies.tasks.create(task);
		} catch {
			const raced = await this.dependencies.tasks.findByIdempotencyKey(
				input.idempotencyKey,
			);
			if (raced) {
				if (
					raced.draft_id !== input.draftId ||
					raced.user_id !== input.userId ||
					raced.expected_version !== input.expectedVersion
				)
					throw new ApiError(
						409,
						"idempotency_key_conflict",
						"幂等键已用于其他发布请求",
					);
				return toPublishTaskDto(raced);
			}
			const active = await this.dependencies.tasks.findActiveByDraftId(
				input.draftId,
			);
			if (active)
				throw new ApiError(
					409,
					"publish_already_requested",
					"草稿已有未结束的发布任务",
				);
			throw new ApiError(
				500,
				"publish_task_create_failed",
				"发布任务创建失败",
				true,
			);
		}
		if (!(await this.dependencies.tasks.claim(task.id, this.now())))
			return this.getTask(task.id);
		let result: { blobSha: string; commitSha: string };
		try {
			const remote = await this.dependencies.github.getFile(path);
			const target = decidePublishTarget(draft.github_sha, remote?.sha ?? null);
			if (target.mode === "conflict") {
				await this.dependencies.tasks.markFailed(
					task.id,
					"publishing",
					"content_conflict",
					target.code,
					this.now(),
				);
				throw new ApiError(409, target.code, "远端内容冲突");
			}
			result =
				target.mode === "create"
					? await this.dependencies.github.createFile(
							path,
							markdown,
							`Publish ${draft.slug}`,
						)
					: await this.dependencies.github.updateFile(
							path,
							markdown,
							target.sha,
							`Publish ${draft.slug}`,
						);
		} catch (cause) {
			if (cause instanceof ApiError) throw cause;
			const code =
				cause instanceof Error && cause.message === "github_conflict"
					? "github_conflict"
					: "github_write_failed";
			await this.dependencies.tasks.markFailed(
				task.id,
				"publishing",
				"submit_failed",
				code,
				this.now(),
			);
			throw new ApiError(
				code === "github_conflict" ? 409 : 502,
				code,
				"GitHub 写入失败",
				code !== "github_conflict",
			);
		}
		let recorded = false;
		try {
			recorded = await this.dependencies.tasks.recordGitHubCommit(
				task.id,
				result.blobSha,
				result.commitSha,
				this.now(),
			);
		} catch {
			recorded = false;
		}
		if (!recorded) {
			await this.dependencies.tasks.markReconciliationRequired(
				task.id,
				"publishing",
				result.blobSha,
				result.commitSha,
				"github_commit_record_failed",
				this.now(),
			);
			return this.getTask(task.id);
		}
		let bound = false;
		try {
			bound = await this.dependencies.drafts.bindPublished(
				draft.id,
				input.expectedVersion,
				path,
				result.blobSha,
				result.commitSha,
				this.now(),
			);
		} catch {
			bound = false;
		}
		if (!bound) {
			await this.dependencies.tasks.markReconciliationRequired(
				task.id,
				"github_committed",
				result.blobSha,
				result.commitSha,
				"draft_binding_failed",
				this.now(),
			);
			return this.getTask(task.id);
		}
		if (
			!(await this.dependencies.tasks.markAwaitingDeploy(
				task.id,
				"github_committed",
				this.now(),
			))
		) {
			await this.dependencies.tasks.markReconciliationRequired(
				task.id,
				"github_committed",
				result.blobSha,
				result.commitSha,
				"publish_task_finalize_failed",
				this.now(),
			);
		}
		return this.getTask(task.id);
	}

	async reconcile(id: string): Promise<PublishTaskDto> {
		const task = await this.dependencies.tasks.get(id);
		if (!task) throw new ApiError(404, "not_found", "发布任务不存在");
		if (task.status !== "reconciliation_required")
			throw new ApiError(
				409,
				"reconciliation_not_required",
				"发布任务无需对账",
			);
		const remote = await this.dependencies.github.getFile(task.target_path);
		if (
			!remote ||
			remote.sha !== task.github_blob_sha ||
			remote.content === null ||
			(await sha256(remote.content)) !== task.content_sha256
		)
			throw new ApiError(
				409,
				"reconciliation_evidence_mismatch",
				"远端证据不匹配",
			);
		if (!task.github_blob_sha || !task.github_commit_sha)
			throw new ApiError(
				409,
				"reconciliation_evidence_mismatch",
				"远端证据不匹配",
			);
		const draft = await this.dependencies.drafts.get(task.draft_id);
		if (!draft) throw new ApiError(404, "not_found", "草稿不存在");
		const alreadyBound =
			draft.github_sha === task.github_blob_sha &&
			draft.commit_sha === task.github_commit_sha &&
			draft.github_path === task.target_path;
		if (
			!alreadyBound &&
			!(await this.dependencies.drafts.bindPublished(
				task.draft_id,
				task.expected_version,
				task.target_path,
				task.github_blob_sha,
				task.github_commit_sha,
				this.now(),
			))
		)
			throw new ApiError(
				409,
				"content_version_conflict",
				"草稿已被其他请求修改",
			);
		if (
			!(await this.dependencies.tasks.markAwaitingDeploy(
				id,
				"reconciliation_required",
				this.now(),
			))
		)
			throw new ApiError(
				409,
				"publish_task_state_conflict",
				"发布任务状态已变化",
				true,
			);
		return this.getTask(id);
	}
}
