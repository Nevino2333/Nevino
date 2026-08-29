import { ApiError } from "./errors";

// 媒体上传的类型与大小校验：图片沿用魔数校验，音频校验文件头签名，
// 歌词/文本要求可按 UTF-8 解码且不含 NUL 字节。
export type UploadKind = "image" | "audio" | "text";

export const UPLOAD_LIMITS: Record<UploadKind, number> = {
	image: 10 * 1024 * 1024,
	audio: 20 * 1024 * 1024,
	text: 1024 * 1024,
};

const EXTENSION_KIND: Record<string, UploadKind> = {
	png: "image",
	jpg: "image",
	jpeg: "image",
	webp: "image",
	gif: "image",
	mp3: "audio",
	flac: "audio",
	ogg: "audio",
	oga: "audio",
	wav: "audio",
	m4a: "audio",
	lrc: "text",
	txt: "text",
};

const CANONICAL: Record<UploadKind, Record<string, string>> = {
	image: { png: "png", jpg: "jpg", jpeg: "jpg", webp: "webp", gif: "gif" },
	audio: { mp3: "mp3", flac: "flac", ogg: "ogg", oga: "ogg", wav: "wav", m4a: "m4a" },
	text: { lrc: "lrc", txt: "txt" },
};

export const MIME_BY_EXTENSION: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	mp3: "audio/mpeg",
	flac: "audio/flac",
	ogg: "audio/ogg",
	wav: "audio/wav",
	m4a: "audio/mp4",
	lrc: "text/plain; charset=utf-8",
	txt: "text/plain; charset=utf-8",
};

export const extensionOf = (name: string): string =>
	name.toLowerCase().split(".").pop() ?? "";

const matchesImageSignature = (bytes: Uint8Array, extension: string): boolean => {
	if (extension === "png")
		return (
			bytes.length >= 8 &&
			bytes
				.slice(0, 8)
				.every(
					(value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index],
				)
		);
	if (extension === "jpg")
		return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
	if (extension === "webp")
		return (
			bytes.length >= 12 &&
			new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
			new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
		);
	return (
		bytes.length >= 6 &&
		(new TextDecoder().decode(bytes.slice(0, 6)) === "GIF87a" ||
			new TextDecoder().decode(bytes.slice(0, 6)) === "GIF89a")
	);
};

const matchesAudioSignature = (bytes: Uint8Array, extension: string): boolean => {
	if (extension === "mp3")
		return (
			(bytes.length >= 3 && new TextDecoder().decode(bytes.slice(0, 3)) === "ID3") ||
			(bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
		);
	if (extension === "flac")
		return bytes.length >= 4 && new TextDecoder().decode(bytes.slice(0, 4)) === "fLaC";
	if (extension === "ogg" || extension === "oga")
		return bytes.length >= 4 && new TextDecoder().decode(bytes.slice(0, 4)) === "OggS";
	if (extension === "wav")
		return (
			bytes.length >= 12 &&
			new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
			new TextDecoder().decode(bytes.slice(8, 12)) === "WAVE"
		);
	return bytes.length >= 8 && new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp";
};

const isPlainText = (bytes: Uint8Array): boolean => {
	if (bytes.includes(0)) return false;
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return true;
	} catch {
		return false;
	}
};

export type ResolvedUpload = {
	kind: UploadKind;
	mime: string;
	extension: string;
	maxBytes: number;
};

export function validateUpload(
	filename: string,
	declaredMime: string,
	size: number,
	bytes: Uint8Array,
): ResolvedUpload {
	const extension = extensionOf(filename);
	const kind = EXTENSION_KIND[extension];
	if (!kind)
		throw new ApiError(
			415,
			"invalid_media_type",
			"仅支持图片、音频（mp3/flac/ogg/wav/m4a）与歌词（lrc/txt）文件",
		);
	const canonical = CANONICAL[kind][extension] ?? extension;
	const mime = MIME_BY_EXTENSION[canonical] ?? declaredMime.toLowerCase();
	const maxBytes = UPLOAD_LIMITS[kind];
	if (size <= 0)
		throw new ApiError(400, "invalid_file", "文件内容为空");
	if (size > maxBytes)
		throw new ApiError(
			413,
			"payload_too_large",
			`文件超出 ${Math.round(maxBytes / 1024 / 1024)}MB 上限`,
		);
	if (kind === "image" && !matchesImageSignature(bytes, canonical))
		throw new ApiError(415, "invalid_media_signature", "图片内容与扩展名不匹配");
	if (kind === "audio" && !matchesAudioSignature(bytes, canonical))
		throw new ApiError(415, "invalid_media_signature", "音频内容与扩展名不匹配");
	if (kind === "text" && !isPlainText(bytes))
		throw new ApiError(415, "invalid_media_signature", "歌词文件必须是 UTF-8 文本");
	return { kind, mime, extension: canonical, maxBytes };
}
