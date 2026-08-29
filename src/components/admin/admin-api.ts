type ApiErrorBody = {
	code?: string;
	message?: string;
	fieldErrors?: Record<string, string>;
	retryable?: boolean;
	requestId?: string;
};

type ApiSuccessBody<T> = {
	data: T;
	requestId: string;
};

type Fetcher = typeof fetch;

export type AdminClient = {
	request<T>(path: string, options?: RequestInit): Promise<T>;
	loadCsrf(): Promise<string>;
	clearCsrf(): void;
};

export class AdminApiError extends Error {
	status: number;
	code: string;
	fieldErrors?: Record<string, string>;
	retryable: boolean;
	requestId: string;

	constructor(status: number, body: ApiErrorBody) {
		super(body.message || body.code || "请求失败");
		this.name = "AdminApiError";
		this.status = status;
		this.code = body.code || "request_failed";
		this.fieldErrors = body.fieldErrors;
		this.retryable = body.retryable === true;
		this.requestId = body.requestId || "";
	}
}

function isMutation(method: string): boolean {
	return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function loginUrl(): string {
	const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
	return `/admin/login/?returnTo=${encodeURIComponent(returnTo)}`;
}

export function createAdminClient(fetcher: Fetcher = fetch): AdminClient {
	let csrfToken = "";

	async function rawRequest<T>(
		path: string,
		options: RequestInit = {},
	): Promise<T> {
		const response = await fetcher(
			path.startsWith("/api/admin/") ? path : `/api/admin${path}`,
			{
				...options,
				credentials: "same-origin",
				headers: {
					...(options.body instanceof FormData
						? {}
						: { "Content-Type": "application/json" }),
					...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
					...options.headers,
				},
			},
		);
		const body = (await response.json().catch(() => ({}))) as
			| ApiSuccessBody<T>
			| ApiErrorBody;
		if (!response.ok) {
			if (response.status === 401 && typeof window !== "undefined")
				window.location.assign(loginUrl());
			throw new AdminApiError(response.status, body as ApiErrorBody);
		}
		return "data" in body ? body.data : (body as T);
	}

	async function ensureCsrf(): Promise<void> {
		if (csrfToken) return;
		const data = await rawRequest<{
			authenticated: boolean;
			csrfToken: string;
		}>("/session", { headers: {} });
		csrfToken = data.csrfToken;
	}

	return {
		async request<T>(path: string, options: RequestInit = {}): Promise<T> {
			if (path !== "/login" && isMutation(options.method || "GET"))
				await ensureCsrf();
			return rawRequest<T>(path, options);
		},
		async loadCsrf(): Promise<string> {
			await ensureCsrf();
			return csrfToken;
		},
		clearCsrf(): void {
			csrfToken = "";
		},
	};
}

export const adminApi: AdminClient = createAdminClient();
export const adminRequest: AdminClient["request"] = adminApi.request;
