export interface Env {
	DB: D1Database;
	MEDIA_BUCKET?: R2Bucket;
	SESSION_SECRET: string;
	ADMIN_BOOTSTRAP_SECRET?: string;
	DEPLOYMENT_CALLBACK_SECRET?: string;
	ALLOWED_ORIGIN: string;
	GITHUB_TOKEN?: string;
	GITHUB_OWNER?: string;
	GITHUB_REPO?: string;
	GITHUB_BRANCH?: string;
}

export interface PagesContext<E = Env> {
	request: Request;
	env: E;
	params: Record<string, string | undefined>;
	waitUntil(promise: Promise<unknown>): void;
}

export type PagesFunction<E = Env> = (
	context: PagesContext<E>,
) => Response | Promise<Response>;

export interface AdminUserRow {
	id: string;
	username: string;
	password_hash: string;
	failed_attempts: number;
	locked_until: number | null;
}

export interface SessionRow {
	id: string;
	user_id: string;
	expires_at: number;
}

export type LegacyContentStatus = "draft" | "published" | "build_failed";
export type ContentPublicationState =
	| "draft"
	| "published"
	| "withdrawn"
	| "deleted";
export type ContentWorkspaceState = "clean" | "modified";
export type ContentSyncStatus =
	| "local"
	| "publishing"
	| "published"
	| "reconciliation_required";

export interface DraftRow {
	id: string;
	slug: string;
	title: string;
	published: string;
	updated: string | null;
	description: string;
	ai_summary: string;
	image: string;
	tags_json: string;
	category: string;
	lang: string;
	pinned: number;
	author: string;
	source_link: string;
	license_name: string;
	license_url: string;
	comment: number;
	content: string;
	status: LegacyContentStatus;
	created_at: string;
	updated_at: string;
	github_path: string | null;
	github_sha: string | null;
	commit_sha: string | null;
	content_id: string;
	version: number;
	sync_status: ContentSyncStatus;
	publication_state?: ContentPublicationState;
	workspace_state?: ContentWorkspaceState;
	deployed_path?: string | null;
	deployed_blob_sha?: string | null;
	deployed_commit_sha?: string | null;
	deployed_at?: string | null;
	deleted_at?: string | null;
}

export interface PublishTaskRow {
	id: string;
	idempotency_key: string;
	draft_id: string;
	user_id: string;
	expected_version: number;
	target_path: string;
	content_sha256: string;
	status:
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
	attempts: number;
	github_blob_sha: string | null;
	github_commit_sha: string | null;
	error_code: string | null;
	error_detail: string | null;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
}

export type ContentRevisionSource =
	| "save"
	| "import"
	| "publish"
	| "rename"
	| "rollback";

export interface ContentRevisionRow {
	id: string;
	draft_id: string;
	content_id: string;
	version: number;
	source: ContentRevisionSource;
	title: string;
	slug: string;
	markdown: string;
	content_sha256: string;
	github_blob_sha: string | null;
	github_commit_sha: string | null;
	created_by: string;
	created_at: string;
}

export type ContentOperationType =
	| "import"
	| "rename"
	| "withdraw"
	| "delete"
	| "rollback";
export type ContentOperationStatus =
	| "pending"
	| "github_committed"
	| "completed"
	| "reconciliation_required"
	| "failed";

export interface ContentOperationRow {
	id: string;
	idempotency_key: string;
	type: ContentOperationType;
	status: ContentOperationStatus;
	draft_id: string | null;
	content_id: string;
	user_id: string;
	expected_version: number;
	source_path: string | null;
	target_path: string | null;
	expected_blob_sha: string | null;
	result_blob_sha: string | null;
	commit_sha: string | null;
	content_sha256: string;
	source_commit_sha: string | null;
	error_code: string | null;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
}

export interface DraftInput {
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
}
