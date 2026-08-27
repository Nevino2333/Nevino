export interface Env {
	DB: D1Database;
	MEDIA_BUCKET?: R2Bucket;
	SESSION_SECRET: string;
	ADMIN_BOOTSTRAP_SECRET?: string;
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

export type PagesFunction<E = Env> = (context: PagesContext<E>) => Response | Promise<Response>;

export interface AdminUser {
	id: string;
	username: string;
	password_hash: string;
	failed_attempts: number;
	locked_until: number | null;
}

export interface Session {
	id: string;
	user_id: string;
	expires_at: number;
}

export interface Draft {
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
	status: "draft" | "published";
	created_at: string;
	updated_at: string;
	github_path: string | null;
	github_sha: string | null;
	commit_sha: string | null;
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
