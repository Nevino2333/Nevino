import type { PagesContext } from "./api/admin/_shared/types";

/**
 * /tts —— Edge TTS 代理：把文本合成为 MP3 音频（微软 Edge 朗读神经音色）。
 *
 * 说明：Edge TWS WebSocket 是微软官方客户端使用的非公开接口，
 * 社区广泛使用但随时可能变动；前端在失败时会自动降级到浏览器本地合成。
 * 请求：GET /tts?text=<utf8 文本，≤1000 字符>&voice=<音色白名单，可选>
 * 响应：audio/mpeg（24kHz 48kbps 单声道）
 */

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
// Workers 里发起 WebSocket 用 https:// + Upgrade 头（wss:// 会被 fetch 拒绝）
const WSS_BASE_URL =
	"https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const SEC_MS_GEC_VERSION = "1-131.0.2903.112";
const EDGE_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.112";
const VOICE_WHITELIST = new Set([
	"zh-CN-XiaoxiaoNeural",
	"zh-CN-YunxiNeural",
	"zh-CN-XiaoyiNeural",
	"zh-CN-YunyangNeural",
]);
const MAX_TEXT_LENGTH = 1000;
const SYNTHESIS_TIMEOUT_MS = 30000;

interface TtsEnv {
	// 无需数据库或存储；显式空环境避免误用其他绑定
}

// Sec-MS-GEC DRM 令牌：Windows 文件时间向下取整到 5 分钟边界（100ns 刻度）
// 拼接 TrustedClientToken 后取 SHA-256 大写十六进制，与微软客户端算法一致
async function generateSecMsGec(): Promise<string> {
	const WIN_EPOCH_SECONDS = 11644473600;
	const nowSeconds = Math.floor(Date.now() / 1000);
	const roundedSeconds = nowSeconds - (nowSeconds % 300);
	const ticks = BigInt(roundedSeconds + WIN_EPOCH_SECONDS) * 10_000_000n;
	const payload = new TextEncoder().encode(`${ticks}${TRUSTED_CLIENT_TOKEN}`);
	const digest = await crypto.subtle.digest("SHA-256", payload);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase();
}

const escapeSsml = (value: string): string =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		// 去掉控制字符（保留普通空白），避免 SSML 解析失败
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

const connectEdgeSocket = async (voice: string): Promise<WebSocket> => {
	const secMsGec = await generateSecMsGec();
	const url = `${WSS_BASE_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
	const response = await fetch(url, {
		headers: {
			Upgrade: "websocket",
			"User-Agent": EDGE_USER_AGENT,
			Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
		},
	});
	if (!response.ok || !response.websocket) {
		throw new Error(`edge tts handshake failed: ${response.status}`);
	}
	const socket = response.websocket;
	socket.accept();
	return socket;
};

// 二进制帧 = ASCII 头部（\r\n\r\n 结束）+ 载荷；只取 Path:audio 的语音数据
const extractAudioPayload = (buffer: ArrayBuffer): Uint8Array | null => {
	const bytes = new Uint8Array(buffer);
	const separator = 13; // \r
	for (let i = 0; i < bytes.length - 3; i++) {
		if (
			bytes[i] === separator &&
			bytes[i + 1] === 10 &&
			bytes[i + 2] === separator &&
			bytes[i + 3] === 10
		) {
			const header = new TextDecoder().decode(bytes.slice(0, i));
			if (!header.includes("Path:audio")) return null;
			return bytes.slice(i + 4);
		}
	}
	return null;
};

const synthesize = async (text: string, voice: string): Promise<Uint8Array> => {
	const socket = await connectEdgeSocket(voice);
	const audioChunks: Uint8Array[] = [];
	const requestId = crypto.randomUUID().replaceAll("-", "");

	try {
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error("edge tts synthesis timeout")),
				SYNTHESIS_TIMEOUT_MS,
			);

			socket.addEventListener("open", () => {
				const timestamp = new Date().toString();
				socket.send(
					`X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
						`{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`,
				);
				socket.send(
					`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}\r\nPath:ssml\r\n\r\n` +
						`<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'><voice name='${voice}'><prosody rate='+0%' pitch='+0Hz'>${escapeSsml(text)}</prosody></voice></speak>`,
				);
			});

			socket.addEventListener("message", (event) => {
				const data = event.data;
				if (typeof data === "string") {
					if (data.includes("Path:turn.end")) {
						clearTimeout(timeout);
						resolve();
					}
					return;
				}
				const payload = extractAudioPayload(data as ArrayBuffer);
				if (payload && payload.length > 0) audioChunks.push(payload);
			});

			socket.addEventListener("error", () => {
				clearTimeout(timeout);
				reject(new Error("edge tts socket error"));
			});

			socket.addEventListener("close", () => {
				clearTimeout(timeout);
				resolve();
			});
		});
	} finally {
		try {
			socket.close();
		} catch {}
	}

	if (audioChunks.length === 0) throw new Error("edge tts returned no audio");
	const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const merged = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of audioChunks) {
		merged.set(chunk, offset);
		offset += chunk.length;
	}
	return merged;
};

export const onRequestGet = async (
	context: PagesContext<TtsEnv>,
): Promise<Response> => {
	const url = new URL(context.request.url);
	const text = (url.searchParams.get("text") ?? "").trim();
	const voice = url.searchParams.get("voice") ?? "zh-CN-XiaoxiaoNeural";

	if (!text) {
		return Response.json({ error: "text is required" }, { status: 400 });
	}
	if (text.length > MAX_TEXT_LENGTH) {
		return Response.json({ error: "text too long" }, { status: 413 });
	}
	if (!VOICE_WHITELIST.has(voice)) {
		return Response.json({ error: "voice not allowed" }, { status: 400 });
	}

	try {
		const audio = await synthesize(text, voice);
		return new Response(audio, {
			status: 200,
			headers: {
				"Content-Type": "audio/mpeg",
				// 同一段文本的音频让浏览器缓存，重听不重复合成
				"Cache-Control": "public, max-age=86400",
			},
		});
	} catch (error) {
		console.error(
			`[tts] synthesis failed:`,
			error instanceof Error ? error.message : error,
		);
		return Response.json({ error: "tts unavailable" }, { status: 502 });
	}
};
