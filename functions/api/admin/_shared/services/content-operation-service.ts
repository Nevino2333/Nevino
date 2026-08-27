import { ApiError } from "../errors";
import { isAllowedGitHubPath } from "../github";
import { parsePostMarkdown } from "../markdown";
import type { ContentOperationRow, DraftRow } from "../types";

export type ImportGateway = {
	getHead(): Promise<string>;
	getFile(
		path: string,
		ref: string,
	): Promise<{ sha: string; content: string } | null>;
	updateFile?(input: {
		path: string;
		content: string;
		expectedBlobSha: string;
		expectedHeadCommitSha: string;
	}): Promise<{ blobSha: string; commitSha: string }>;
	deleteFile?(input: {
		path: string;
		expectedBlobSha: string;
		expectedHeadCommitSha: string;
	}): Promise<{ blobSha: null; commitSha: string }>;
	renameFile?(input: {
		sourcePath: string;
		targetPath: string;
		content: string;
		expectedBlobSha: string;
		expectedHeadCommitSha: string;
	}): Promise<{ blobSha: string; commitSha: string }>;
};

export type ImportStore = {
	getDraft?(id: string): Promise<DraftRow | null>;
	findByIdempotencyKey(key: string): Promise<ContentOperationRow | null>;
	findByPath(path: string): Promise<DraftRow | null>;
	findBySlug(slug: string): Promise<DraftRow | null>;
	createPending(row: ContentOperationRow): Promise<ContentOperationRow>;
	importPublished(
		draft: DraftRow,
		revision: {
			id: string;
			userId: string;
			markdown: string;
			contentSha256: string;
			operation: ContentOperationRow;
		},
	): Promise<DraftRow>;
	markGitHubCommitted?(
		id: string,
		now: string,
		blobSha: string | null,
		commitSha: string,
	): Promise<boolean>;
	markReconciliationRequired?(
		id: string,
		now: string,
		blobSha: string | null,
		commitSha: string,
		errorCode: string,
	): Promise<boolean>;
	markCompleted(
		id: string,
		now: string,
		blobSha: string | null,
		commitSha: string | null,
	): Promise<boolean>;
};

export type ImportCandidate = {
	id: string;
	path: string;
	slug: string | null;
	classification: "importable" | "bound" | "unsupported" | "invalid";
	draftId: string | null;
};

export const classifyImportCandidates = (
	paths: string[],
	bindings: Map<string, string>,
): ImportCandidate[] =>
	paths.flatMap((path) => {
		if (
			!path.startsWith("src/content/posts/") ||
			(!path.endsWith("/index.md") && !path.endsWith("/index.mdx"))
		)
			return [];
		const parts = path.split("/");
		const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parts[3] ?? "")
			? parts[3]
			: null;
		const draftId = bindings.get(path) ?? null;
		const classification = !slug
			? "invalid"
			: path.endsWith(".mdx")
				? "unsupported"
				: draftId
					? "bound"
					: "importable";
		return [{ id: path, path, slug, classification, draftId }];
	});

export class ContentOperationService {
	constructor(
		private readonly options: {
			store: ImportStore;
			gateway: ImportGateway;
			now: () => string;
			newId: () => string;
		},
	) {}

	async importPost(input: {
		path: string;
		expectedSha: string;
		idempotencyKey: string;
		userId: string;
	}): Promise<DraftRow> {
		if (!isAllowedGitHubPath(input.path))
			throw new ApiError(400, "path_not_allowed", "GitHub 路径不允许");
		const existing = await this.options.store.findByIdempotencyKey(
			input.idempotencyKey,
		);
		if (existing?.status === "completed") {
			const draft = existing.draft_id
				? await this.options.store.findByPath(input.path)
				: null;
			if (draft) return draft;
		}
		if (existing)
			throw new ApiError(409, "idempotency_conflict", "幂等键已被使用");
		if (
			!input.idempotencyKey ||
			input.idempotencyKey.length < 8 ||
			input.idempotencyKey.length > 128
		)
			throw new ApiError(400, "idempotency_key_invalid", "幂等键无效");
		const bound = await this.options.store.findByPath(input.path);
		if (bound)
			throw new ApiError(409, "content_already_imported", "文章已导入");
		const head = await this.options.gateway.getHead();
		const file = await this.options.gateway.getFile(input.path, head);
		if (!file)
			throw new ApiError(404, "github_file_not_found", "GitHub 文件不存在");
		if (file.sha !== input.expectedSha)
			throw new ApiError(409, "content_sha_conflict", "远端内容 SHA 已变化");
		const slug = input.path.split("/")[3] ?? "";
		const draft = parsePostMarkdown(file.content, slug);
		if (await this.options.store.findBySlug(draft.slug))
			throw new ApiError(409, "content_slug_conflict", "文章 slug 已存在");
		const now = this.options.now();
		const operation: ContentOperationRow = {
			id: this.options.newId(),
			idempotency_key: input.idempotencyKey,
			type: "import",
			status: "pending",
			draft_id: this.options.newId(),
			content_id: this.options.newId(),
			user_id: input.userId,
			expected_version: 0,
			source_path: input.path,
			target_path: input.path,
			expected_blob_sha: input.expectedSha,
			result_blob_sha: null,
			commit_sha: null,
			content_sha256: await sha256(file.content),
			source_commit_sha: head,
			error_code: null,
			created_at: now,
			updated_at: now,
			completed_at: null,
		};
		const imported: DraftRow = {
			id: operation.draft_id as string,
			content_id: operation.content_id,
			slug: draft.slug,
			title: draft.title,
			published: draft.published,
			updated: draft.updated ?? null,
			description: draft.description ?? "",
			ai_summary: draft.aiSummary ?? "",
			image: draft.image ?? "",
			tags_json: JSON.stringify(draft.tags ?? []),
			category: draft.category ?? "",
			lang: draft.lang ?? "",
			pinned: draft.pinned ? 1 : 0,
			author: draft.author ?? "",
			source_link: draft.sourceLink ?? "",
			license_name: draft.licenseName ?? "",
			license_url: draft.licenseUrl ?? "",
			comment: draft.comment === false ? 0 : 1,
			content: draft.content,
			status: "published",
			created_at: now,
			updated_at: now,
			github_path: input.path,
			github_sha: file.sha,
			commit_sha: head,
			version: 1,
			sync_status: "published",
			publication_state: "published",
			workspace_state: "clean",
			deployed_commit_sha: head,
			deployed_at: now,
			deleted_at: null,
		};
		return this.options.store.importPublished(imported, {
			id: this.options.newId(),
			userId: input.userId,
			markdown: file.content,
			contentSha256: operation.content_sha256,
			operation: {
				...operation,
				status: "completed",
				result_blob_sha: file.sha,
				commit_sha: head,
				completed_at: now,
			},
		});
	}

	async renamePost(input: {
		draftId: string;
		newSlug: string;
		expectedVersion: number;
		expectedBlobSha: string;
		idempotencyKey: string;
		userId: string;
	}): Promise<ContentOperationRow> {
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.newSlug))
			throw new ApiError(422, "slug_invalid", "slug 无效");
		if (
			!input.idempotencyKey ||
			input.idempotencyKey.length < 8 ||
			input.idempotencyKey.length > 128
		)
			throw new ApiError(400, "idempotency_key_invalid", "幂等键无效");
		const existing = await this.options.store.findByIdempotencyKey(
			input.idempotencyKey,
		);
		if (existing) {
			if (
				existing.type === "rename" &&
				existing.draft_id === input.draftId &&
				existing.expected_version === input.expectedVersion &&
				existing.expected_blob_sha === input.expectedBlobSha &&
				existing.target_path === `src/content/posts/${input.newSlug}/index.md`
			)
				return existing;
			throw new ApiError(
				409,
				"idempotency_key_conflict",
				"幂等键已用于其他请求",
			);
		}
		if (!this.options.store.getDraft || !this.options.gateway.renameFile)
			throw new ApiError(500, "rename_not_configured", "重命名服务未配置");
		const draft = await this.options.store.getDraft(input.draftId);
		if (!draft) throw new ApiError(404, "not_found", "文章不存在");
		if (draft.version !== input.expectedVersion)
			throw new ApiError(
				409,
				"content_version_conflict",
				"文章已被其他请求修改",
			);
		const sourcePath = draft.deployed_path ?? null;
		const sourceBlobSha = draft.deployed_blob_sha ?? null;
		const sourceCommitSha = draft.deployed_commit_sha ?? null;
		if (
			(draft.publication_state ??
				(draft.status === "published" ? "published" : "draft")) !==
				"published" ||
			(draft.workspace_state ?? "modified") !== "clean" ||
			draft.sync_status !== "published" ||
			!sourcePath ||
			!sourceBlobSha ||
			!sourceCommitSha ||
			!draft.deployed_at
		)
			throw new ApiError(
				409,
				"rename_state_conflict",
				"仅可重命名已部署且同步的文章",
			);
		if (sourceBlobSha !== input.expectedBlobSha)
			throw new ApiError(409, "content_blob_conflict", "部署 blob 已变化");
		const targetPath = `src/content/posts/${input.newSlug}/index.md`;
		if (!isAllowedGitHubPath(sourcePath) || !isAllowedGitHubPath(targetPath))
			throw new ApiError(400, "path_not_allowed", "GitHub 路径不允许");
		const slugOwner = await this.options.store.findBySlug(input.newSlug);
		const pathOwner = await this.options.store.findByPath(targetPath);
		if (
			(slugOwner && slugOwner.id !== draft.id) ||
			(pathOwner && pathOwner.id !== draft.id)
		)
			throw new ApiError(
				409,
				"rename_target_conflict",
				"目标 slug 或路径已被占用",
			);
		const head = await this.options.gateway.getHead();
		if (head !== sourceCommitSha)
			throw new ApiError(409, "github_head_changed", "GitHub HEAD 已变化");
		const target = await this.options.gateway.getFile(targetPath, head);
		if (target)
			throw new ApiError(
				409,
				"rename_target_conflict",
				"GitHub 目标路径已存在",
			);
		const source = await this.options.gateway.getFile(sourcePath, head);
		if (!source || source.sha !== input.expectedBlobSha)
			throw new ApiError(409, "content_blob_conflict", "远端内容已变化");
		const now = this.options.now();
		const operation: ContentOperationRow = {
			id: this.options.newId(),
			idempotency_key: input.idempotencyKey,
			type: "rename",
			status: "pending",
			draft_id: draft.id,
			content_id: draft.content_id,
			user_id: input.userId,
			expected_version: input.expectedVersion,
			source_path: sourcePath,
			target_path: targetPath,
			expected_blob_sha: input.expectedBlobSha,
			result_blob_sha: null,
			commit_sha: null,
			content_sha256: await sha256(source.content),
			source_commit_sha: head,
			error_code: null,
			created_at: now,
			updated_at: now,
			completed_at: null,
		};
		try {
			await this.options.store.createPending(operation);
		} catch {
			const raced = await this.options.store.findByIdempotencyKey(
				input.idempotencyKey,
			);
			if (raced) return raced;
			throw new ApiError(409, "content_operation_active", "文章已有活动操作");
		}
		const committed = await this.options.gateway.renameFile({
			sourcePath,
			targetPath,
			content: source.content,
			expectedBlobSha: input.expectedBlobSha,
			expectedHeadCommitSha: head,
		});
		try {
			if (
				!this.options.store.markGitHubCommitted ||
				!(await this.options.store.markGitHubCommitted(
					operation.id,
					now,
					committed.blobSha,
					committed.commitSha,
				))
			)
				throw new Error("github_commit_record_failed");
		} catch {
			await this.options.store.markReconciliationRequired?.(
				operation.id,
				now,
				committed.blobSha,
				committed.commitSha,
				"github_commit_record_failed",
			);
			return {
				...operation,
				status: "reconciliation_required",
				result_blob_sha: committed.blobSha,
				commit_sha: committed.commitSha,
				error_code: "github_commit_record_failed",
				updated_at: now,
			};
		}
		return {
			...operation,
			status: "github_committed",
			result_blob_sha: committed.blobSha,
			commit_sha: committed.commitSha,
			updated_at: now,
		};
	}
	async withdrawPost(input: {
		draftId: string;
		expectedVersion: number;
		idempotencyKey: string;
		userId: string;
	}): Promise<ContentOperationRow> {
		if (
			!input.idempotencyKey ||
			input.idempotencyKey.length < 8 ||
			input.idempotencyKey.length > 128
		)
			throw new ApiError(400, "idempotency_key_invalid", "幂等键无效");
		const existing = await this.options.store.findByIdempotencyKey(
			input.idempotencyKey,
		);
		if (existing) {
			if (
				existing.type === "withdraw" &&
				existing.draft_id === input.draftId &&
				existing.expected_version === input.expectedVersion
			)
				return existing;
			throw new ApiError(
				409,
				"idempotency_key_conflict",
				"幂等键已用于其他请求",
			);
		}
		if (!this.options.store.getDraft || !this.options.gateway.deleteFile)
			throw new ApiError(500, "withdraw_not_configured", "撤回服务未配置");
		const draft = await this.options.store.getDraft(input.draftId);
		if (!draft) throw new ApiError(404, "not_found", "文章不存在");
		if (draft.version !== input.expectedVersion)
			throw new ApiError(
				409,
				"content_version_conflict",
				"文章已被其他请求修改",
			);
		const path = draft.deployed_path ?? null;
		const blobSha = draft.deployed_blob_sha ?? null;
		const commitSha = draft.deployed_commit_sha ?? null;
		if (
			(draft.publication_state ??
				(draft.status === "published" ? "published" : "draft")) !==
				"published" ||
			(draft.workspace_state ?? "modified") !== "clean" ||
			draft.sync_status !== "published" ||
			!path ||
			!blobSha ||
			!commitSha ||
			!draft.deployed_at
		)
			throw new ApiError(
				409,
				"withdraw_state_conflict",
				"仅可撤回已部署且同步的文章",
			);
		if (!isAllowedGitHubPath(path))
			throw new ApiError(400, "path_not_allowed", "GitHub 路径不允许");
		const head = await this.options.gateway.getHead();
		const remote = await this.options.gateway.getFile(path, head);
		if (!remote || remote.sha !== blobSha)
			throw new ApiError(409, "content_blob_conflict", "远端内容已变化");
		if (!this.options.gateway.deleteFile)
			throw new ApiError(500, "withdraw_not_configured", "撤回服务未配置");
		const now = this.options.now();
		const operation: ContentOperationRow = {
			id: this.options.newId(),
			idempotency_key: input.idempotencyKey,
			type: "withdraw",
			status: "pending",
			draft_id: draft.id,
			content_id: draft.content_id,
			user_id: input.userId,
			expected_version: input.expectedVersion,
			source_path: path,
			target_path: path,
			expected_blob_sha: blobSha,
			result_blob_sha: null,
			commit_sha: null,
			content_sha256: await sha256(remote.content),
			source_commit_sha: head,
			error_code: null,
			created_at: now,
			updated_at: now,
			completed_at: null,
		};
		try {
			await this.options.store.createPending(operation);
		} catch {
			const raced = await this.options.store.findByIdempotencyKey(
				input.idempotencyKey,
			);
			if (raced) return raced;
			throw new ApiError(409, "content_operation_active", "文章已有活动操作");
		}
		const committed = await this.options.gateway.deleteFile({
			path,
			expectedBlobSha: blobSha,
			expectedHeadCommitSha: head,
		});
		try {
			if (
				!this.options.store.markGitHubCommitted ||
				!(await this.options.store.markGitHubCommitted(
					operation.id,
					now,
					committed.blobSha,
					committed.commitSha,
				))
			)
				throw new Error("github_commit_record_failed");
		} catch {
			await this.options.store.markReconciliationRequired?.(
				operation.id,
				now,
				committed.blobSha,
				committed.commitSha,
				"github_commit_record_failed",
			);
			return {
				...operation,
				status: "reconciliation_required",
				result_blob_sha: committed.blobSha,
				commit_sha: committed.commitSha,
				error_code: "github_commit_record_failed",
				updated_at: now,
			};
		}
		return {
			...operation,
			status: "github_committed",
			result_blob_sha: committed.blobSha,
			commit_sha: committed.commitSha,
			updated_at: now,
		};
	}
	async deletePost(input: {
		draftId: string;
		expectedVersion: number;
		idempotencyKey: string;
		userId: string;
	}): Promise<ContentOperationRow> {
		if (
			!input.idempotencyKey ||
			input.idempotencyKey.length < 8 ||
			input.idempotencyKey.length > 128
		)
			throw new ApiError(400, "idempotency_key_invalid", "幂等键无效");
		const existing = await this.options.store.findByIdempotencyKey(
			input.idempotencyKey,
		);
		if (existing) {
			if (
				existing.type === "delete" &&
				existing.draft_id === input.draftId &&
				existing.expected_version === input.expectedVersion
			)
				return existing;
			throw new ApiError(
				409,
				"idempotency_key_conflict",
				"幂等键已用于其他请求",
			);
		}
		if (!this.options.store.getDraft || !this.options.gateway.deleteFile)
			throw new ApiError(500, "delete_not_configured", "删除服务未配置");
		const draft = await this.options.store.getDraft(input.draftId);
		if (!draft) throw new ApiError(404, "not_found", "文章不存在");
		if (draft.version !== input.expectedVersion)
			throw new ApiError(
				409,
				"content_version_conflict",
				"文章已被其他请求修改",
			);
		const publicationState =
			draft.publication_state ??
			(draft.status === "published" ? "published" : "draft");
		const path = draft.deployed_path ?? null;
		const blobSha = draft.deployed_blob_sha ?? null;
		if (
			(publicationState !== "published" && publicationState !== "withdrawn") ||
			draft.workspace_state !== "clean" ||
			draft.sync_status !== "published" ||
			!path ||
			!blobSha ||
			!draft.deployed_commit_sha
		)
			throw new ApiError(
				409,
				"delete_state_conflict",
				"文章状态不允许线上删除",
			);
		if (!isAllowedGitHubPath(path))
			throw new ApiError(400, "path_not_allowed", "GitHub 路径不允许");
		const head = await this.options.gateway.getHead();
		const remote = await this.options.gateway.getFile(path, head);
		if (!remote || remote.sha !== blobSha)
			throw new ApiError(409, "content_blob_conflict", "远端内容已变化");
		const now = this.options.now();
		const operation: ContentOperationRow = {
			id: this.options.newId(),
			idempotency_key: input.idempotencyKey,
			type: "delete",
			status: "pending",
			draft_id: draft.id,
			content_id: draft.content_id,
			user_id: input.userId,
			expected_version: input.expectedVersion,
			source_path: path,
			target_path: null,
			expected_blob_sha: blobSha,
			result_blob_sha: null,
			commit_sha: null,
			content_sha256: await sha256(remote.content),
			source_commit_sha: head,
			error_code: null,
			created_at: now,
			updated_at: now,
			completed_at: null,
		};
		try {
			await this.options.store.createPending(operation);
		} catch {
			const raced = await this.options.store.findByIdempotencyKey(
				input.idempotencyKey,
			);
			if (raced) return raced;
			throw new ApiError(409, "content_operation_active", "文章已有活动操作");
		}
		const committed = await this.options.gateway.deleteFile({
			path,
			expectedBlobSha: blobSha,
			expectedHeadCommitSha: head,
		});
		try {
			if (
				!this.options.store.markGitHubCommitted ||
				!(await this.options.store.markGitHubCommitted(
					operation.id,
					now,
					null,
					committed.commitSha,
				))
			)
				throw new Error("github_commit_record_failed");
		} catch {
			await this.options.store.markReconciliationRequired?.(
				operation.id,
				now,
				null,
				committed.commitSha,
				"github_commit_record_failed",
			);
			return {
				...operation,
				status: "reconciliation_required",
				commit_sha: committed.commitSha,
				error_code: "github_commit_record_failed",
				updated_at: now,
			};
		}
		return {
			...operation,
			status: "github_committed",
			commit_sha: committed.commitSha,
			updated_at: now,
		};
	}
}

const sha256 = async (value: string): Promise<string> => {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
};

export { sha256 };
