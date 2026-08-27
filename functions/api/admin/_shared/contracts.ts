export type ApiErrorBody = {
	code: string;
	message: string;
	fieldErrors?: Record<string, string>;
	retryable: boolean;
	requestId: string;
};

export type ApiSuccessBody<T> = {
	data: T;
	requestId: string;
};

export type DraftSummaryDto = {
	id: string;
	contentId: string;
	slug: string;
	title: string;
	status: "draft" | "published" | "build_failed";
	syncStatus: string;
	publicationState: "draft" | "published" | "withdrawn" | "deleted";
	workspaceState: "clean" | "modified" | "editing";
	published: string;
	tags: string[];
	category: string;
	capabilities: {
		editable: boolean;
		publishable: boolean;
		renameable: boolean;
		withdrawable: boolean;
		deletable: boolean;
		reconcilable: boolean;
		discardable?: boolean;
	};
	version: number;
	updatedAt: string;
};

export type DraftDetailDto = DraftSummaryDto & {
	deployedBlobSha: string | null;
	deployedCommitSha: string | null;
	deployedAt: string | null;
	updated: string | null;
	description: string;
	aiSummary: string;
	image: string;
	tags: string[];
	category: string;
	lang: string;
	pinned: boolean;
	author: string;
	sourceLink: string;
	licenseName: string;
	licenseUrl: string;
	comment: boolean;
	content: string;
	createdAt: string;
	githubPath: string | null;
	githubSha: string | null;
	commitSha: string | null;
	publishTask: PublishTaskDto | null;
};

export type PostImportCandidateDto = {
	id: string;
	path: string;
	expectedSha: string;
	slug: string | null;
	classification: "importable" | "bound" | "unsupported" | "invalid";
	draftId: string | null;
};

export type PostImportCandidatePageDto = {
	items: PostImportCandidateDto[];
	page: number;
	pageSize: number;
	total: number;
};

export type DraftWriteDto = {
	slug: string;
	title: string;
	published: string;
	updated?: string;
	description?: string;
	aiSummary?: string;
	image?: string;
	tags?: string[];
	category?: string;
	lang?: string;
	pinned?: boolean;
	author?: string;
	sourceLink?: string;
	licenseName?: string;
	licenseUrl?: string;
	comment?: boolean;
	content: string;
	version?: number;
};

export type PublishRequestDto = {
	idempotencyKey: string;
	expectedVersion: number;
};

export type PublishTaskStatus =
	| "pending"
	| "publishing"
	| "github_committed"
	| "awaiting_deploy"
	| "published"
	| "validation_failed"
	| "content_conflict"
	| "submit_failed"
	| "reconciliation_required"
	| "build_failed"
	| "rolled_back";

export type PublishTaskDto = {
	id: string;
	draftId: string;
	expectedVersion: number;
	targetPath: string;
	status: PublishTaskStatus;
	attempts: number;
	githubBlobSha: string | null;
	githubCommitSha: string | null;
	errorCode: string | null;
	createdAt: string;
	updatedAt: string;
	completedAt: string | null;
};
