import assert from "node:assert/strict";
import test from "node:test";
import {
	canConfirmTitle,
	isOperationPendingReconciliation,
	operationRequest,
	rollbackRequest,
	rollbackRequestForDraft,
} from "../../src/components/admin/admin-operations";

test("标题确认必须完整匹配", () => {
	assert.equal(canConfirmTitle("文章标题", "文章标题"), true);
	assert.equal(canConfirmTitle("文章标题", " 文章标题 "), false);
	assert.equal(canConfirmTitle("文章标题", "文章"), false);
});

test("危险操作请求只包含契约字段", () => {
	assert.deepEqual(
		operationRequest(3, "request-key", { newSlug: "new-slug" }),
		{
			expectedVersion: 3,
			idempotencyKey: "request-key",
			newSlug: "new-slug",
		},
	);
	assert.deepEqual(operationRequest(3, "request-key", { password: "secret" }), {
		expectedVersion: 3,
		idempotencyKey: "request-key",
		password: "secret",
	});
});

test("回滚请求使用当前草稿 deployed blob 证据和内存密码", () => {
	assert.deepEqual(
		rollbackRequest(
			4,
			"request-key",
			"a".repeat(40),
			"blob-current-deployed",
			"secret",
		),
		{
			expectedVersion: 4,
			idempotencyKey: "request-key",
			sourceCommitSha: "a".repeat(40),
			expectedBlobSha: "blob-current-deployed",
			password: "secret",
		},
	);
});

test("从草稿构造回滚请求时不使用历史详情 blob", () => {
	assert.equal(
		rollbackRequestForDraft(
			{ version: 4, deployedBlobSha: "blob-current-deployed" },
			"request-key",
			"a".repeat(40),
			"secret",
		).expectedBlobSha,
		"blob-current-deployed",
	);
});

test("仅待对账操作显示恢复入口", () => {
	assert.equal(
		isOperationPendingReconciliation({ status: "reconciliation_required" }),
		true,
	);
	assert.equal(
		isOperationPendingReconciliation({ status: "completed" }),
		false,
	);
	assert.equal(isOperationPendingReconciliation(null), false);
});
