import { adminGet } from "../_shared/handler";

type TaskRow = {
	id: string;
	idempotency_key: string;
	draft_id: string;
	draft_title: string | null;
	expected_version: number;
	target_path: string;
	status: string;
	attempts: number;
	github_blob_sha: string | null;
	github_commit_sha: string | null;
	error_code: string | null;
	created_at: string;
	updated_at: string;
	awaiting_deploy_stale?: boolean;
};

// awaiting_deploy 超过该时长仍未收到构建回调时，在列表中标记为疑似挂起，
// 提醒管理员用"解除等待"处理；不在 GET 里偷偷改状态，状态机变更仍走显式端点
const AWAITING_DEPLOY_STALE_MS = 30 * 60 * 1000;

export const onRequestGet = adminGet(async (context) => {
	const url = new URL(context.request.url);
	const statusFilter = url.searchParams.get("status") ?? "";
	const limit = Math.min(
		Math.max(Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1),
		100,
	);
	let statement = "SELECT t.id, t.idempotency_key, t.draft_id, d.title AS draft_title, t.expected_version, t.target_path, t.status, t.attempts, t.github_blob_sha, t.github_commit_sha, t.error_code, t.created_at, t.updated_at FROM admin_publish_tasks t LEFT JOIN admin_drafts d ON d.id = t.draft_id";
	const bindings: string[] = [];
	if (statusFilter) {
		statement += " WHERE t.status = ?";
		bindings.push(statusFilter);
	}
	statement += " ORDER BY t.created_at DESC LIMIT ?";
	const result = await context.env.DB.prepare(statement)
		.bind(...bindings, limit)
		.all<TaskRow>();
	const now = Date.now();
	const items = (result.results ?? []).map((row) => ({
		...row,
		awaiting_deploy_stale:
			row.status === "awaiting_deploy" &&
			now - Date.parse(row.updated_at) > AWAITING_DEPLOY_STALE_MS,
	}));
	return { items };
});
