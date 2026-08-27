import assert from "node:assert/strict";
import test from "node:test";
import {
	AdminApiError,
	createAdminClient,
} from "../../src/components/admin/admin-api";

test("写请求自动附加 CSRF 并解包统一成功响应", async () => {
	const requests: { input: string; init?: RequestInit }[] = [];
	const client = createAdminClient(async (input, init) => {
		requests.push({ input: String(input), init });
		if (String(input).endsWith("/csrf")) {
			return Response.json({ data: { csrfToken: "token-1" }, requestId: "r1" });
		}
		return Response.json({ data: { saved: true }, requestId: "r2" });
	});

	const result = await client.request<{ saved: boolean }>("/drafts", {
		method: "POST",
		body: JSON.stringify({ title: "Test" }),
	});

	assert.deepEqual(result, { saved: true });
	assert.equal(
		new Headers(requests[1]?.init?.headers).get("X-CSRF-Token"),
		"token-1",
	);
	assert.equal(requests[1]?.init?.credentials, "same-origin");
});

test("登录请求不预取需要会话的 CSRF", async () => {
	const paths: string[] = [];
	const client = createAdminClient(async (input) => {
		paths.push(String(input));
		return Response.json({ data: { authenticated: true }, requestId: "r1" });
	});

	await client.request("/login", {
		method: "POST",
		body: JSON.stringify({ username: "admin", password: "secret" }),
	});

	assert.deepEqual(paths, ["/api/admin/login"]);
});

test("保留统一错误体字段", async () => {
	const client = createAdminClient(async () =>
		Response.json(
			{
				code: "content_version_conflict",
				message: "版本冲突",
				fieldErrors: { version: "已过期" },
				retryable: false,
				requestId: "request-1",
			},
			{ status: 409 },
		),
	);

	await assert.rejects(
		client.request("/drafts/draft-1"),
		(error: unknown) =>
			error instanceof AdminApiError &&
			error.status === 409 &&
			error.code === "content_version_conflict" &&
			error.fieldErrors?.version === "已过期" &&
			error.retryable === false &&
			error.requestId === "request-1",
	);
});
