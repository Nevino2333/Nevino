import assert from "node:assert/strict";
import test from "node:test";
import {
	bestEffortAudit,
	serializeAuditMetadata,
} from "../../functions/api/admin/_shared/audit";

test("审计元数据包含请求和资源结果上下文", () => {
	assert.equal(
		serializeAuditMetadata({
			requestId: "request-1",
			resourceType: "draft",
			resourceId: "draft-1",
			result: "success",
			metadata: { version: 2 },
		}),
		JSON.stringify({
			requestId: "request-1",
			resourceType: "draft",
			resourceId: "draft-1",
			result: "success",
			metadata: { version: 2 },
		}),
	);
});

test("审计元数据移除非 JSON 基础值并限制长度", () => {
	const serialized = serializeAuditMetadata({
		requestId: "request-2",
		result: "failure",
		metadata: {
			safe: true,
			nested: [1, "value", null],
			secret: undefined,
			function: () => "no",
		},
	});
	assert.ok(serialized.length <= 4096);
	assert.deepEqual(JSON.parse(serialized), {
		requestId: "request-2",
		result: "failure",
		metadata: { safe: true, nested: [1, "value", null] },
	});
});

test("业务已成功时审计写入失败不改写业务结果", async () => {
	await assert.doesNotReject(
		bestEffortAudit(async () => {
			throw new Error("audit unavailable");
		}),
	);
});
