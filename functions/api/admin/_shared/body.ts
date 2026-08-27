import { json } from "./security";

type JsonResult = { data: unknown; response: null } | { data: null; response: Response };

export const readJson = async (request: Request, maxBytes: number): Promise<JsonResult> => {
	const contentLength = request.headers.get("Content-Length");
	if (contentLength !== null) {
		const length = Number(contentLength);
		if (!Number.isSafeInteger(length) || length < 0) return { data: null, response: json({ error: "invalid_request" }, 400) };
		if (length > maxBytes) return { data: null, response: json({ error: "payload_too_large" }, 413) };
	}
	if (!request.body) return { data: null, response: json({ error: "invalid_json" }, 400) };
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel();
				return { data: null, response: json({ error: "payload_too_large" }, 413) };
			}
			chunks.push(value);
		}
		const bytes = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return { data: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), response: null };
	} catch {
		return { data: null, response: json({ error: "invalid_json" }, 400) };
	} finally {
		reader.releaseLock();
	}
};
