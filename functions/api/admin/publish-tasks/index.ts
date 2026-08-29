import { adminGet } from "../_shared/handler";

type TaskRow = {
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

export const onRequestGet = adminGet(async (context) => {
	const url = new URL(context.request.url);
	const statusFilter = url.searchParams.get("status") ?? "";
	const limit = Math.min(
		Math.max(Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1),
		100,
	);
	let statement = "SELECT id, idempotency_key, draft_id, expected_version, target_path, status, attempts, github_blob_sha, github_commit_sha, error_code, created_at, updated_at FROM admin_publish_tasks";
	const bindings: string[] = [];
	if (statusFilter) {
		statement += " WHERE status = ?";
		bindings.push(statusFilter);
	}
	statement += " ORDER BY created_at DESC LIMIT ?";
	const result = await context.env.DB.prepare(statement)
		.bind(...bindings, limit)
		.all<TaskRow>();
	return { items: result.results ?? [] };
});
