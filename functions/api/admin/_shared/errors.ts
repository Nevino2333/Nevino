import type { ApiErrorBody, ApiSuccessBody } from "./contracts";

const headers = {
	"Content-Type": "application/json; charset=utf-8",
	"Cache-Control": "no-store",
};

export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly retryable = false,
		readonly fieldErrors?: Record<string, string>,
	) {
		super(message);
	}
}

export const successResponse = <T>(
	data: T,
	requestId: string,
	status = 200,
	extraHeaders: HeadersInit = {},
): Response =>
	new Response(
		JSON.stringify({ data, requestId } satisfies ApiSuccessBody<T>),
		{ status, headers: { ...headers, ...extraHeaders } },
	);

export const errorResponse = (error: unknown, requestId: string): Response => {
	const apiError =
		error instanceof ApiError
			? error
			: new ApiError(500, "internal_error", "服务器内部错误", true);
	const body: ApiErrorBody = {
		code: apiError.code,
		message: apiError.message,
		retryable: apiError.retryable,
		requestId,
	};
	if (apiError.fieldErrors) body.fieldErrors = apiError.fieldErrors;
	return new Response(JSON.stringify(body), {
		status: apiError.status,
		headers,
	});
};
