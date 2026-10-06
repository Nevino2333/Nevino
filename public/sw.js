/**
 * Firefly PWA Service Worker
 *
 * 缓存策略（仅同源 GET 请求）：
 * - HTML（导航或 swup 的 fetch）：network-first，3 秒超时回退缓存 —— 保证内容新鲜，
 *   弱网/断网时仍能打开看过的页面
 * - 带内容哈希的静态资源（/_astro/、/pagefind/）：cache-first —— 文件名变即 URL 变，可永久缓存
 * - 其余同源静态资源（/assets/、/js/、字体等）：cache-first
 * - 大文件（壁纸、音乐、看板娘）：cache-first，但放进独立缓存并按最近使用淘汰
 *   —— 壁纸池有数十张且会随轮播不断换新的，若不设上限会撑爆移动端 Cache Storage
 *     （配额通常 50~100MB，写满后浏览器会整体清空，反而丢掉已有的缓存）
 * - 动态路由（/api/、/media/、/tts、/admin）与 sw.js 自身完全直通，不拦截。
 *   /admin 直通是因为后台壳必须始终最新：旧壳配新接口会出现状态错乱，
 *   且后台不应有任何"离线旧页面"的容身之处
 *
 * 上线新部署后：HTML 拉到新版本并引用新的哈希资源，旧版本缓存在 activate 时清理。
 * VERSION 升号（v1→v2）会清掉所有旧缓存，强制客户端丢弃可能过期已久的页面快照。
 */
const VERSION = "v2";
const PAGE_CACHE = `firefly-pages-${VERSION}`;
const STATIC_CACHE = `firefly-static-${VERSION}`;
const HEAVY_CACHE = `firefly-heavy-${VERSION}`;
const RUNTIME_CACHE = `firefly-runtime-${VERSION}`;
const KNOWN_CACHES = [PAGE_CACHE, STATIC_CACHE, HEAVY_CACHE, RUNTIME_CACHE];
const RUNTIME_MAX_ENTRIES = 200;
const HEAVY_MAX_ENTRIES = 24;
const NAVIGATION_TIMEOUT = 3000;

const CACHE_FIRST_PREFIXES = ["/_astro/", "/pagefind/", "/assets/", "/js/", "/fonts/", "/favicon/"];
const HEAVY_PREFIXES = ["/assets/images/wallpaper/", "/assets/music/", "/pio/"];
const BYPASS_PREFIXES = ["/api/", "/media/", "/tts", "/admin", "/sw.js"];

self.addEventListener("install", () => {
	self.skipWaiting();
});

// 升级前壁纸/音乐是混在 STATIC_CACHE 里的，那里没有上限。
// 老用户升级后把这部分挪走，否则几十 MB 的历史缓存会一直占着配额。
async function purgeHeavyFromStatic() {
	const cache = await caches.open(STATIC_CACHE);
	const keys = await cache.keys();
	await Promise.all(
		keys
			.filter((req) => HEAVY_PREFIXES.some((p) => new URL(req.url).pathname.startsWith(p)))
			.map((k) => cache.delete(k)),
	);
}

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const names = await caches.keys();
			await Promise.all(names.filter((n) => n.startsWith("firefly-") && !KNOWN_CACHES.includes(n)).map((n) => caches.delete(n)));
			await purgeHeavyFromStatic();
			await self.clients.claim();
		})(),
	);
});

function isHtmlRequest(request) {
	return (request.headers.get("accept") ?? "").includes("text/html");
}

async function trimCache(cacheName, maxEntries) {
	const cache = await caches.open(cacheName);
	const keys = await cache.keys();
	if (keys.length <= maxEntries) return;
	await Promise.all(keys.slice(0, keys.length - maxEntries).map((k) => cache.delete(k)));
}

async function cacheFirst(request, cacheName, maxEntries, event) {
	const cache = await caches.open(cacheName);
	const hit = await cache.match(request);
	if (hit) {
		// 命中即重新写回，把它挪到淘汰队列末尾，让淘汰顺序真正反映「最近使用」。
		// 交给 waitUntil 托管，避免未等待的 promise 在 worker 空闲时被丢弃。
		if (maxEntries) {
			event?.waitUntil(cache.put(request, hit.clone()).then(() => trimCache(cacheName, maxEntries)));
		}
		return hit;
	}
	const response = await fetch(request);
	if (response && response.ok && response.type === "basic") {
		await cache.put(request, response.clone());
		if (maxEntries) await trimCache(cacheName, maxEntries);
	}
	return response;
}

async function staleWhileRevalidate(request, cacheName) {
	const cache = await caches.open(cacheName);
	const hit = await cache.match(request);
	const network = fetch(request)
		.then((response) => {
			if (response && response.ok && response.type === "basic") {
				cache.put(request, response.clone());
				trimCache(cacheName, RUNTIME_MAX_ENTRIES);
			}
			return response;
		})
		.catch(() => undefined);
	return hit ?? (await network) ?? Response.error();
}

async function networkFirstHtml(request) {
	const cache = await caches.open(PAGE_CACHE);
	const cached = await cache.match(request);
	const network = fetch(request)
		.then((response) => {
			if (response && response.ok && response.type === "basic") {
				cache.put(request, response.clone());
			}
			return response;
		})
		.catch(() => undefined);
	if (!cached) return (await network) ?? Response.error();
	const timer = new Promise((resolve) => setTimeout(() => resolve(undefined), NAVIGATION_TIMEOUT));
	const fresh = await Promise.race([network, timer]);
	return fresh ?? cached;
}

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;
	if (BYPASS_PREFIXES.some((p) => url.pathname.startsWith(p))) return;

	if (isHtmlRequest(request)) {
		event.respondWith(networkFirstHtml(request));
		return;
	}
	// 大文件走独立缓存并限量；/assets/ 前缀也命中壁纸，所以必须排在通用分支前面
	if (HEAVY_PREFIXES.some((p) => url.pathname.startsWith(p))) {
		event.respondWith(cacheFirst(request, HEAVY_CACHE, HEAVY_MAX_ENTRIES, event));
		return;
	}
	if (CACHE_FIRST_PREFIXES.some((p) => url.pathname.startsWith(p))) {
		event.respondWith(cacheFirst(request, STATIC_CACHE));
		return;
	}
	event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});
