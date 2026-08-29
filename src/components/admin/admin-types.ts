export type AdminView =
	| "dashboard"
	| "posts"
	| "media"
	| "pages"
	| "friends"
	| "gallery"
	| "announcement"
	| "sponsor"
	| "tools"
	| "music"
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

// ---------------------------------------------------------------------------
// 结构化配置（站点设置与内容分组）
// ---------------------------------------------------------------------------

export type ConfigFieldMeta =
	| {
			key: string;
			type: "text" | "textarea" | "url" | "image" | "color";
			label: string;
			help?: string;
			required?: boolean;
			maxLength?: number;
			placeholder?: string;
			urlPrefixes?: string[];
	  }
	| {
			key: string;
			type: "number";
			label: string;
			help?: string;
			min?: number;
			max?: number;
			integer?: boolean;
	  }
	| { key: string; type: "boolean"; label: string; help?: string }
	| {
			key: string;
			type: "select";
			label: string;
			help?: string;
			options: { value: string; label: string }[];
	  }
	| {
			key: string;
			type: "tags";
			label: string;
			help?: string;
			maxItems?: number;
	  }
	| {
			key: string;
			type: "list";
			label: string;
			help?: string;
			itemLabelKey: string;
			fields: ConfigFieldMeta[];
			defaultItem: Record<string, unknown>;
			maxItems?: number;
			addable?: boolean;
	  };

export type ConfigFieldBinding = {
	id: string;
	block: string;
	path: (string | number)[];
	field: ConfigFieldMeta;
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
	values: Record<string, unknown>;
	baseValues: Record<string, unknown>;
	code: Record<string, string>;
	baseCode: Record<string, string>;
	fields: ConfigFieldBinding[];
	codeFiles: {
		id: string;
		path: string;
		label: string;
		help?: string;
		maxLength: number;
	}[];
};

export type SettingsDiffFile = {
	path: string;
	before: string;
	after: string;
	diff: DiffLine[];
};

export type SettingsDiff = {
	key: string;
	label: string;
	files: SettingsDiffFile[];
};

export type SettingsHistoryItem = {
	id: string;
	version: number;
	commitSha: string | null;
	createdAt: string;
};

export type SettingsPublishResult = {
	commitSha: string;
	published: { key: string; label: string; changed: string[] }[];
	unchanged: { key: string; label: string }[];
};

// ---------------------------------------------------------------------------
// 独立页面
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 发布中心 / 安全 / 仪表盘
// ---------------------------------------------------------------------------

export type PublishTaskRow = {
	id: string;
	idempotency_key: string;
	draft_id: string;
	expected_version: number;
	target_path: string;
	status: string;
	attempts: number;
	github_blob_sha: string | null;
	github_commit_sha: string | null;
	error_code: string | null;
	created_at: string;
	updated_at: string;
};

export type ContentOperationRow = {
	id: string;
	idempotency_key: string;
	type: string;
	status: string;
	draft_id: string | null;
	content_id: string;
	source_path: string | null;
	target_path: string | null;
	commit_sha: string | null;
	error_code: string | null;
	created_at: string;
	updated_at: string;
};

export type AuditItem = {
	id: string;
	action: string;
	ip: string;
	result: string;
	resourceType: string;
	resourceId: string;
	createdAt: string;
};

export type AuditPage = {
	items: AuditItem[];
	nextBefore: string | null;
};

export type SessionItem = {
	id: string;
	createdAt: string;
	expiresAt: number;
	current: boolean;
};

export type AdminOverview = {
	posts: {
		published: number;
		drafts: number;
		withdrawn: number;
		total: number;
	};
	mediaCount: number;
	mediaAvailable: boolean;
	pages: { total: number; staged: number };
	settings: { totalGroups: number; stagedGroups: number };
	publishing: {
		activeTasks: number;
		reconciliationRequired: number;
		failedOperations: number;
		lastDeployedAt: string | null;
	};
	recentAudit: AuditItem[];
	githubConfigured: boolean;
};
