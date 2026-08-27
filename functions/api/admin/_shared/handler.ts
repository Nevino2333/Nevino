import {
	requireAdminGetOrigin,
	requireAuth,
	requireCsrf,
	requireOrigin,
} from "./auth";
import { ApiError, errorResponse, successResponse } from "./errors";
import { randomToken, timingSafeEqual } from "./security";
import type { PagesContext, PagesFunction, SessionRow } from "./types";

type HandlerContext<S extends SessionRow | null> = PagesContext & {
	requestId: string;
	session: S;
};
type HandlerResult<T> = T | { data: T; status?: number; headers?: HeadersInit };
type Handler<T, S extends SessionRow | null> = (
	context: HandlerContext<S>,
) => HandlerResult<T> | Promise<HandlerResult<T>>;

const isResult = <T>(
	value: HandlerResult<T>,
): value is { data: T; status?: number; headers?: HeadersInit } =>
	typeof value === "object" && value !== null && "data" in value;

const execute =
	<T, S extends SessionRow | null>(
		prepare: (context: PagesContext, requestId: string) => Promise<S>,
		handler: Handler<T, S>,
	): PagesFunction =>
	async (context) => {
		const requestId = randomToken(16);
		try {
			const session = await prepare(context, requestId);
			const result = await handler({ ...context, requestId, session });
			return isResult(result)
				? successResponse(result.data, requestId, result.status, result.headers)
				: successResponse(result, requestId);
		} catch (error) {
			return errorResponse(error, requestId);
		}
	};

export const adminGet = <T>(handler: Handler<T, SessionRow>): PagesFunction =>
	execute(async (context) => {
		requireAdminGetOrigin(context.request, context.env);
		return requireAuth(context);
	}, handler);

export const adminMutation = <T>(
	handler: Handler<T, SessionRow>,
): PagesFunction =>
	execute(async (context) => {
		requireOrigin(context.request, context.env);
		const session = await requireAuth(context);
		await requireCsrf(context, session);
		return session;
	}, handler);

export const publicAdminMutation = <T>(
	handler: Handler<T, null>,
): PagesFunction =>
	execute(async (context) => {
		requireOrigin(context.request, context.env);
		return null;
	}, handler);

export const verifyDeploymentCallbackSecret = (
	requestSecret: string,
	configuredSecret: string | undefined,
): void => {
	if (
		!configuredSecret ||
		!timingSafeEqual(
			new TextEncoder().encode(requestSecret),
			new TextEncoder().encode(configuredSecret),
		)
	)
		throw new ApiError(403, "forbidden", "禁止访问");
};

export const deploymentCallback = <T>(
	handler: Handler<T, null>,
): PagesFunction =>
	execute(async (context) => {
		verifyDeploymentCallbackSecret(
			context.request.headers.get("X-Deployment-Callback-Secret") ?? "",
			context.env.DEPLOYMENT_CALLBACK_SECRET,
		);
		return null;
	}, handler);

export const bootstrapMutation = <T>(
	handler: Handler<T, null>,
): PagesFunction =>
	execute(async (context) => {
		requireOrigin(context.request, context.env);
		const configuredSecret = context.env.ADMIN_BOOTSTRAP_SECRET;
		const requestSecret =
			context.request.headers.get("X-Admin-Bootstrap-Secret") ?? "";
		if (
			!configuredSecret ||
			!timingSafeEqual(
				new TextEncoder().encode(requestSecret),
				new TextEncoder().encode(configuredSecret),
			)
		) {
			throw new ApiError(403, "forbidden", "禁止访问");
		}
		return null;
	}, handler);
