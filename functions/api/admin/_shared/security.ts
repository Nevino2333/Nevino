const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 210000;
const MAX_PASSWORD_BYTES = 1024;

export const bytesToBase64Url = (bytes: Uint8Array): string =>
	btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");

export const base64UrlToBytes = (value: string): Uint8Array => {
	const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
	const binary = atob(
		normalized + "=".repeat((4 - (normalized.length % 4)) % 4),
	);
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

export const randomToken = (size = 32): string => {
	const bytes = crypto.getRandomValues(new Uint8Array(size));
	return bytesToBase64Url(bytes);
};

const derivePassword = async (
	password: string,
	salt: string,
): Promise<Uint8Array> => {
	const passwordBytes = encoder.encode(password);
	if (passwordBytes.byteLength > MAX_PASSWORD_BYTES)
		throw new Error("invalid_password");
	const key = await crypto.subtle.importKey(
		"raw",
		passwordBytes,
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			salt: encoder.encode(salt),
			iterations: PASSWORD_ITERATIONS,
			hash: "SHA-256",
		},
		key,
		256,
	);
	return new Uint8Array(bits);
};

export const hashPassword = async (
	password: string,
	salt = randomToken(16),
): Promise<string> => {
	const bits = await derivePassword(password, salt);
	return `pbkdf2$${PASSWORD_ITERATIONS}$${salt}$${bytesToBase64Url(bits)}`;
};

export const verifyPassword = async (
	password: string,
	encoded: string,
): Promise<boolean> => {
	if (
		password.length > 256 ||
		encoder.encode(password).byteLength > MAX_PASSWORD_BYTES
	)
		return false;
	const [scheme, iterations, salt, expected, extra] = encoded.split("$");
	if (
		scheme !== "pbkdf2" ||
		iterations !== String(PASSWORD_ITERATIONS) ||
		!salt ||
		!expected ||
		extra !== undefined ||
		salt.length > 128 ||
		expected.length > 128
	)
		return false;
	try {
		const bits = await derivePassword(password, salt);
		return timingSafeEqual(bits, base64UrlToBytes(expected));
	} catch {
		return false;
	}
};

export const sha256 = async (value: string): Promise<string> => {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
	return bytesToBase64Url(new Uint8Array(digest));
};

export const hmac = async (secret: string, value: string): Promise<string> => {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(value),
	);
	return bytesToBase64Url(new Uint8Array(signature));
};

export const timingSafeEqual = (
	left: Uint8Array,
	right: Uint8Array,
): boolean => {
	if (left.length !== right.length) return false;
	let result = 0;
	for (let index = 0; index < left.length; index += 1)
		result |= left[index] ^ right[index];
	return result === 0;
};

export const cookie = (
	name: string,
	value: string,
	maxAge: number,
	secure: boolean,
): string =>
	`${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Strict`;
export const parseCookie = (request: Request, name: string): string | null => {
	const value = request.headers
		.get("Cookie")
		?.split(";")
		.map((item) => item.trim())
		.find((item) => item.startsWith(`${name}=`));
	const token = value?.slice(name.length + 1) ?? "";
	return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
};
export const text = (value: unknown): string =>
	typeof value === "string" ? value : "";
export const json = (
	data: unknown,
	status = 200,
	headers: HeadersInit = {},
): Response =>
	new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			...headers,
		},
	});
