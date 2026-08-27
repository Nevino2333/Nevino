import { run } from "./db";
import { randomToken } from "./security";
import type { Env } from "./types";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type AuditDetails = {
	requestId: string;
	resourceType?: string;
	resourceId?: string;
	result: "success" | "failure";
	metadata?: unknown;
};

const MAX_METADATA_LENGTH = 4096;

const jsonValue = (value: unknown): JsonValue | undefined => {
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return value;
	if (typeof value === "number")
		return Number.isFinite(value) ? value : undefined;
	if (Array.isArray(value))
		return value
			.map(jsonValue)
			.filter((item): item is JsonValue => item !== undefined);
	if (typeof value !== "object") return undefined;
	const result: { [key: string]: JsonValue } = {};
	for (const [key, item] of Object.entries(value)) {
		const safe = jsonValue(item);
		if (safe !== undefined) result[key] = safe;
	}
	return result;
};

export const serializeAuditMetadata = (details: AuditDetails): string => {
	const value = jsonValue(details) as { [key: string]: JsonValue };
	const serialized = JSON.stringify(value);
	if (serialized.length <= MAX_METADATA_LENGTH) return serialized;
	return JSON.stringify({
		requestId: details.requestId.slice(0, 256),
		resourceType: details.resourceType?.slice(0, 128),
		resourceId: details.resourceId?.slice(0, 256),
		result: details.result,
		metadataTruncated: true,
	});
};

export const bestEffortAudit = async (
	write: () => Promise<void>,
): Promise<void> => {
	try {
		await write();
	} catch {}
};

export const audit = async (
	env: Env,
	userId: string | null,
	action: string,
	request: Request,
	details: AuditDetails,
): Promise<void> => {
	await run(
		env.DB,
		"INSERT INTO admin_audit (id, user_id, action, ip, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		randomToken(16),
		userId,
		action,
		request.headers.get("CF-Connecting-IP") ?? "",
		serializeAuditMetadata(details),
		new Date().toISOString(),
	);
};
