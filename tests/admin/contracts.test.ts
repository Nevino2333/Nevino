import assert from "node:assert/strict";
import test from "node:test";
import {
	ApiError,
	errorResponse,
	successResponse,
} from "../../functions/api/admin/_shared/errors";

test("成功响应使用统一 data 和 requestId 契约", async () => {
	const response = successResponse({ authenticated: true }, "request-1", 201);
	assert.equal(response.status, 201);
	assert.equal(
		response.headers.get("Content-Type"),
		"application/json; charset=utf-8",
	);
	assert.equal(response.headers.get("Cache-Control"), "no-store");
	assert.deepEqual(await response.json(), {
		data: { authenticated: true },
		requestId: "request-1",
	});
});

test("ApiError 响应保留受控字段", async () => {
	const response = errorResponse(
		new ApiError(422, "validation_failed", "输入无效", false, {
			title: "required",
		}),
		"request-2",
	);
	assert.equal(response.status, 422);
	assert.deepEqual(await response.json(), {
		code: "validation_failed",
		message: "输入无效",
		fieldErrors: { title: "required" },
		retryable: false,
		requestId: "request-2",
	});
});

test("未知异常不会泄露原始错误文本", async () => {
	const response = errorResponse(new Error("SQL token secret"), "request-3");
	assert.equal(response.status, 500);
	assert.deepEqual(await response.json(), {
		code: "internal_error",
		message: "服务器内部错误",
		retryable: true,
		requestId: "request-3",
	});
});
