import { adminGet } from "../_shared/handler";

type AuditListRow = {
	id: string;
	action: string;
	ip: string;
	metadata: string | null;
	created_at: string;
};

const parseMetadata = (raw: string | null): { result?: string; resourceType?: string; resourceId?: string } => {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as {
			result?: string;
			resourceType?: string;
			resourceId?: string;
		};
		return {
			result: parsed.result ?? "",
			resourceType: parsed.resourceType ?? "",
			resourceId: parsed.resourceId ?? "",
		};
	} catch {
		return {};
	}
};

export const onRequestGet = adminGet(async (context) => {
	const url = new URL(context.request.url);
	const limit = Math.min(
		Math.max(Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
		200,
	);
	const before = url.searchParams.get("before") ?? "";
	let statement = "SELECT id, action, ip, metadata, created_at FROM admin_audit";
	const bindings: string[] = [];
	if (before) {
		statement += " WHERE created_at < ?";
		bindings.push(before);
	}
	statement += " ORDER BY created_at DESC LIMIT ?";
	const result = await context.env.DB.prepare(statement)
		.bind(...bindings, limit)
		.all<AuditListRow>();
	const items = (result.results ?? []).map((row) => {
		const metadata = parseMetadata(row.metadata);
		return {
			id: row.id,
			action: row.action,
			ip: row.ip,
			result: metadata.result ?? "",
			resourceType: metadata.resourceType ?? "",
			resourceId: metadata.resourceId ?? "",
			createdAt: row.created_at,
		};
	});
	const nextBefore =
		items.length === limit ? (items.at(-1)?.createdAt ?? null) : null;
	return { items, nextBefore };
});
