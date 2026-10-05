import type { PagesContext } from "./api/admin/_shared/types";

/**
 * /tts —— Edge TTS 代理：把文本合成为 MP3 音频（微软 Edge 朗读神经音色）。
 *
 * 握手细节与 edge-tts 7.2.8 官方实现对齐（Chromium 143 版本串、
 * ConnectionId/MUID、Pragma 等头、403 时按服务器 Date 头校正时钟偏移后重试）。
 * 该接口为微软客户端使用的非公开接口，可能随时变动；前端失败时自动降级。
 *
 * 请求：GET /tts?text=<utf8 文本，≤1000 字符>&voice=<音色白名单，可选>
 * 响应：audio/mpeg（24kHz 48kbps 单声道）
 */

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
// Workers 里发起 WebSocket 用 https:// + Upgrade 头（wss:// 会被 fetch 拒绝）
const WSS_BASE_URL =
	"https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split(".")[0];
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const WIN_EPOCH_SECONDS = 11644473600;
const MAX_TEXT_LENGTH = 1000;
const SYNTHESIS_TIMEOUT_MS = 30000;

const VOICE_WHITELIST = new Set([
	"zh-CN-XiaoxiaoNeural",
	"zh-CN-YunxiNeural",
	"zh-CN-XiaoyiNeural",
	"zh-CN-YunyangNeural",
]);

interface TtsEnv {
	// 配置了 Azure Speech 免费层（F0 每月 50 万字符）后优先走官方 REST API：
	// 在 CF Pages 项目环境变量里设置 AZURE_SPEECH_KEY 和 AZURE_SPEECH_REGION（如 eastasia）
	AZURE_SPEECH_KEY?: string;
	AZURE_SPEECH_REGION?: string;
}

// Sec-MS-GEC DRM 令牌：Windows 文件时间（含时钟偏移校正）向下取整到 5 分钟
// 边界（100ns 刻度），拼接 TrustedClientToken 后取 SHA-256 大写十六进制
const generateSecMsGec = async (skewSeconds = 0): Promise<string> => {
	const unixSeconds = Math.floor(Date.now() / 1000) + skewSeconds;
	let ticks = unixSeconds + WIN_EPOCH_SECONDS;
	ticks -= ticks % 300;
	const ticks100ns = BigInt(ticks) * 10_000_000n;
	const payload = new TextEncoder().encode(
		`${ticks100ns}${TRUSTED_CLIENT_TOKEN}`,
	);
	const digest = await crypto.subtle.digest("SHA-256", payload);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase();
};

const randomHex32 = (): string => crypto.randomUUID().replaceAll("-", "");

// 与 edge-tts 的 date_to_string 一致的时间戳格式
const dateToString = (): string => {
	const d = new Date();
	const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	const months = [
		"Jan", "Feb", "Mar", "Apr", "May", "Jun",
		"Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
	];
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${d.getUTCFullYear()} ` +
		`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ` +
		`GMT+0000 (Coordinated Universal Time)`
	);
};

const escapeSsml = (value: string): string =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

// 发起 WebSocket 握手；403 时按服务器 Date 头校正本机时钟偏移并重试一次
// （时钟偏差是社区公认的 403 头号原因，edge-tts 同款做法）
const connectEdgeSocket = async (): Promise<WebSocket> => {
	const headers = () => ({
		Upgrade: "websocket",
		Pragma: "no-cache",
		"Cache-Control": "no-cache",
		Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
		"Accept-Encoding": "gzip, deflate, br, zstd",
		"Accept-Language": "en-US,en;q=0.9",
		"User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
		Cookie: `muid=${randomHex32()};`,
	});

	const handshake = async (skewSeconds: number): Promise<Response> => {
		const secMsGec = await generateSecMsGec(skewSeconds);
		return fetch(
			`${WSS_BASE_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
				`&ConnectionId=${randomHex32()}` +
				`&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`,
			{ headers: headers() },
		);
	};

	let response = await handshake(0);
	if (response.status === 403) {
		const serverDate = response.headers.get("date");
		let skewSeconds = 0;
		if (serverDate) {
			skewSeconds = Math.floor((Date.parse(serverDate) - Date.now()) / 1000);
		}
		response = await handshake(skewSeconds);
	}
	// WebSocket 升级成功返回 101（不在 ok 的 200-299 范围内）；
	// Workers 的响应属性是 webSocket（大写 S），兼容旧写法 websocket
	const upgraded = response as Response & {
		webSocket?: WebSocket;
		websocket?: WebSocket;
	};
	const socket = upgraded.webSocket ?? upgraded.websocket;
	if ((response.status !== 101 && !response.ok) || !socket) {
		throw new Error(`edge tts handshake failed: ${response.status}`);
	}
	socket.accept();
	return socket;
};

// 二进制帧格式（edge-tts 同款）：前 2 字节（大端）= 头部长度，
// 之后是 "Key: Value" 头块（含长度字节），载荷从 header_length + 2 开始。
// 只收集 Path:audio 的语音帧，跳过 Path:audio.metadata 等元数据帧。
const extractAudioPayload = (data: Uint8Array | ArrayBuffer): Uint8Array | null => {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
	if (bytes.length < 4) return null;
	const headerLength = (bytes[0] << 8) | bytes[1];
	if (headerLength <= 0 || headerLength + 2 > bytes.length) return null;
	const headerBlock = new TextDecoder().decode(
		bytes.slice(0, Math.min(headerLength + 2, bytes.length)),
	);
	if (!/\r\nPath:audio\r\n/.test(headerBlock)) return null;
	return bytes.slice(headerLength + 2);
};

const synthesize = async (text: string, voice: string): Promise<Uint8Array> => {
	const socket = await connectEdgeSocket();
	const audioChunks: Uint8Array[] = [];

	try {
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error("edge tts synthesis timeout")),
				SYNTHESIS_TIMEOUT_MS,
			);

			// 先挂监听再发送；Workers 的客户端 socket 在握手完成时已就绪，
			// 不会触发 open 事件，必须直接发送
			socket.addEventListener("message", (event) => {
				const data = event.data;
				if (typeof data === "string") {
					if (data.includes("Path:turn.end")) {
						clearTimeout(timeout);
						resolve();
					}
					return;
				}
				const bytes =
					data instanceof Uint8Array
						? data
						: new Uint8Array(data as ArrayBuffer);
				const payload = extractAudioPayload(bytes);
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

			const timestamp = dateToString();
				// 消息格式与 edge-tts 逐字对齐：config 结尾必须带 \r\n，
				// SSML 的 X-Timestamp 带大写 Z 后缀（微软客户端的历史 bug 行为）
				socket.send(
					`X-RequestId:${randomHex32()}\r\nX-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
						`{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`,
				);
				socket.send(
					`X-RequestId:${randomHex32()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}Z\r\nPath:ssml\r\n\r\n` +
						`<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeSsml(text)}</prosody></voice></speak>`,
				);
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

// Azure 官方 REST 合成：POST SSML，直接返回音频（配置了密钥时优先使用）
const synthesizeWithAzure = async (
	text: string,
	voice: string,
	env: TtsEnv,
): Promise<Response> => {
	const region = env.AZURE_SPEECH_REGION || "eastasia";
	const response = await fetch(
		`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
		{
			method: "POST",
			headers: {
				"Ocp-Apim-Subscription-Key": env.AZURE_SPEECH_KEY ?? "",
				"Content-Type": "application/ssml+xml",
				"X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
				"User-Agent": "nevino-blog",
			},
			body:
				`<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
				`<voice name='${voice}'>${escapeSsml(text)}</voice></speak>`,
		},
	);
	if (!response.ok) {
		console.error(`[tts] azure synthesis failed: ${response.status}`);
		return Response.json({ error: "azure tts failed" }, { status: 502 });
	}
	return new Response(response.body, {
		status: 200,
		headers: {
			"Content-Type": "audio/mpeg",
			// 同一段文本的音频让浏览器缓存，重听不重复合成
			"Cache-Control": "public, max-age=86400",
		},
	});
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

	// 优先走 Azure 官方 API（配置了密钥时）；失败再尝试 Edge WebSocket
	if (context.env.AZURE_SPEECH_KEY) {
		try {
			return await synthesizeWithAzure(text, voice, context.env);
		} catch (error) {
			console.error(
				"[tts] azure path threw:",
				error instanceof Error ? error.message : error,
			);
		}
	}

	try {
		const audio = await synthesize(text, voice);
		return new Response(audio, {
			status: 200,
			headers: {
				"Content-Type": "audio/mpeg",
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
