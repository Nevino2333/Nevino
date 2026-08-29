import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../functions/api/admin/_shared/errors";
import { validateUpload } from "../../functions/api/admin/_shared/media-validation";

const expectCode = (fn: () => unknown, code: string) => {
	assert.throws(fn, (error: unknown) => error instanceof ApiError && error.code === code);
};

test("媒体上传校验接受合法文本歌词", () => {
	const result = validateUpload("song.lrc", "text/plain", 18, new TextEncoder().encode("[00:01.00]歌词"));
	assert.equal(result.kind, "text");
	assert.equal(result.extension, "lrc");
	assert.equal(result.mime, "text/plain; charset=utf-8");
});

test("媒体上传校验拒绝不支持的扩展名", () => {
	expectCode(() => validateUpload("song.exe", "application/octet-stream", 3, new Uint8Array([1, 2, 3])), "invalid_media_type");
});

test("媒体上传校验拒绝伪造的音频签名", () => {
	expectCode(() => validateUpload("song.mp3", "audio/mpeg", 4, new Uint8Array([1, 2, 3, 4])), "invalid_media_signature");
});

test("媒体上传校验拒绝含 NUL 的歌词", () => {
	expectCode(() => validateUpload("song.lrc", "text/plain", 3, new Uint8Array([91, 0, 93])), "invalid_media_signature");
});

test("媒体上传校验拒绝超过类型上限的文件", () => {
	expectCode(() => validateUpload("song.lrc", "text/plain", 1024 * 1024 + 1, new Uint8Array([91])), "payload_too_large");
});
