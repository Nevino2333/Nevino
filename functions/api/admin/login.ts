import { login } from "./_shared/auth";
import { readJson } from "./_shared/body";
import { ApiError } from "./_shared/errors";
import { publicAdminMutation } from "./_shared/handler";

const LOGIN_BODY_LIMIT = 1024;

export const onRequestPost = publicAdminMutation(async (context) => {
	const parsed = await readJson(context.request, LOGIN_BODY_LIMIT);
	if (parsed.response)
		throw new ApiError(
			parsed.response.status,
			parsed.response.status === 413 ? "payload_too_large" : "invalid_request",
			"登录请求无效",
		);
	if (
		!parsed.data ||
		typeof parsed.data !== "object" ||
		Array.isArray(parsed.data)
	)
		throw new ApiError(401, "invalid_credentials", "用户名或密码错误");
	const input = parsed.data as Record<string, unknown>;
	const username =
		typeof input.username === "string" && input.username.length <= 64
			? input.username
			: "";
	const password =
		typeof input.password === "string" && input.password.length <= 256
			? input.password
			: "";
	const result = await login(context, username, password, context.requestId);
	return {
		data: { authenticated: true },
		headers: { "Set-Cookie": result.cookie },
	};
});
