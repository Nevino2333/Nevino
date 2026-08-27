export type AdminView =
	| "dashboard"
	| "posts"
	| "media"
	| "pages"
	| "settings"
	| "publishing"
	| "security";

export type PostFilterState = {
	query: string;
	publicationState: "all" | "draft" | "published" | "withdrawn";
	workspaceState: "all" | "clean" | "modified";
	syncStatus:
		| "all"
		| "local"
		| "publishing"
		| "published"
		| "modified"
		| "reconciliation_required";
	tag: string;
	category: string;
	page: number;
};

export type AdminRoute = {
	view: AdminView;
	resourceId: string | null;
	postFilters: PostFilterState;
};

export type ContentStatus = "draft" | "published" | "build_failed";
export type ContentPublicationState =
	| "draft"
	| "published"
	| "withdrawn"
	| "deleted";
export type ContentWorkspaceState = "clean" | "modified" | "editing";
export type ContentSyncStatus =
	| "local"
	| "publishing"
	| "published"
	| "modified"
	| "reconciliation_required"
	| string;

export type ContentCapabilities = {
	editable: boolean;
	publishable: boolean;
	renameable: boolean;
	withdrawable: boolean;
	deletable: boolean;
	reconcilable: boolean;
	discardable?: boolean;
};

export type DraftSummary = {
	id: string;
	contentId: string;
	slug: string;
	title: string;
	status: ContentStatus;
	syncStatus: ContentSyncStatus;
	publicationState: ContentPublicationState;
	workspaceState: ContentWorkspaceState;
	published: string;
	tags: string[];
	category: string;
	capabilities: ContentCapabilities;
	version: number;
	updatedAt: string;
};

export type DraftDetail = DraftSummary & {
	deployedBlobSha: string | null;
	deployedCommitSha: string | null;
	deployedAt: string | null;
	updated: string | null;
	description: string;
	aiSummary: string;
	image: string;
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
	publishTask: PublishTask | null;
};

export type DraftWrite = {
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

export type DraftPage = {
	items: DraftSummary[];
	page: number;
	pageSize: number;
	total: number;
};

export type PostImportCandidate = {
	id: string;
	path: string;
	expectedSha: string;
	slug: string | null;
	classification: "importable" | "bound" | "unsupported" | "invalid";
	draftId: string | null;
};

export type PostImportCandidatePage = {
	items: PostImportCandidate[];
	page: number;
	pageSize: number;
	total: number;
};

export type ContentOperation = {
	id: string;
	type: "import" | "rename" | "withdraw" | "delete" | "rollback";
	status:
		| "pending"
		| "github_committed"
		| "completed"
		| "reconciliation_required"
		| "failed";
	draft_id: string | null;
	content_id: string;
	expected_version: number;
	source_path: string | null;
	target_path: string | null;
	expected_blob_sha: string | null;
	result_blob_sha: string | null;
	commit_sha: string | null;
	source_commit_sha: string | null;
	error_code: string | null;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
};

export type ContentHistoryItem = {
	id: string;
	contentId: string;
	createdAt: string;
	sources: Array<"operation" | "revision" | "github">;
	path: string | null;
	commitSha: string | null;
	operationId: string | null;
	revisionId: string | null;
	operationType: string | null;
	operationStatus: string | null;
	revisionSource: string | null;
	version: number | null;
	message: string | null;
	authorName: string | null;
};

export type ContentHistoryPage = {
	items: ContentHistoryItem[];
	page: number;
	pageSize: number;
	total: number;
};

export type DiffLine = {
	type: "context" | "add" | "remove";
	oldLine: number | null;
	newLine: number | null;
	text: string;
};

export type HistoryDetail = {
	record: {
		id: string;
		contentId: string;
		path: string;
		commitSha: string;
	};
	blobSha: string;
	markdown: string;
	parsed: DraftWrite | null;
	editable: boolean;
	diff: DiffLine[];
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

export type PublishTask = {
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

export type MediaAsset = {
	id: string;
	object_key: string;
	public_url: string;
	filename: string;
	mime_type: string;
	size: number;
	created_at: string;
};
