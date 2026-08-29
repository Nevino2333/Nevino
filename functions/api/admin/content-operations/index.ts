import { adminGet } from "../_shared/handler";

type OperationRow = {
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

export const onRequestGet = adminGet(async (context) => {
	const url = new URL(context.request.url);
	const statusFilter = url.searchParams.get("status") ?? "";
	const limit = Math.min(
		Math.max(Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1),
		100,
	);
	let statement = "SELECT id, idempotency_key, type, status, draft_id, content_id, source_path, target_path, commit_sha, error_code, created_at, updated_at FROM admin_content_operations";
	const bindings: string[] = [];
	if (statusFilter) {
		statement += " WHERE status = ?";
		bindings.push(statusFilter);
	}
	statement += " ORDER BY created_at DESC LIMIT ?";
	const result = await context.env.DB.prepare(statement)
		.bind(...bindings, limit)
		.all<OperationRow>();
	return { items: result.results ?? [] };
});
