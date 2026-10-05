/**
 * Firefly PWA Service Worker
 *
 * 缓存策略（仅同源 GET 请求）：
 * - HTML（导航或 swup 的 fetch）：network-first，3 秒超时回退缓存 —— 保证内容新鲜，
 *   弱网/断网时仍能打开看过的页面
 * - 带内容哈希的静态资源（/_astro/、/pagefind/）：cache-first —— 文件名变即 URL 变，可永久缓存
 * - 其余同源静态资源（/assets/、/js/、字体等）：cache-first，上限 200 条
 * - 动态路由（/api/、/media/）与 sw.js 自身完全直通，不拦截
 *
 * 上线新部署后：HTML 拉到新版本并引用新的哈希资源，旧版本缓存在 activate 时清理。
 */
const VERSION = "v1";
const PAGE_CACHE = `firefly-pages-${VERSION}`;
const STATIC_CACHE = `firefly-static-${VERSION}`;
const RUNTIME_CACHE = `firefly-runtime-${VERSION}`;
const KNOWN_CACHES = [PAGE_CACHE, STATIC_CACHE, RUNTIME_CACHE];
const RUNTIME_MAX_ENTRIES = 200;
const NAVIGATION_TIMEOUT = 3000;

const CACHE_FIRST_PREFIXES = ["/_astro/", "/pagefind/", "/assets/", "/js/", "/fonts/", "/favicon/"];
const BYPASS_PREFIXES = ["/api/", "/media/", "/sw.js"];

self.addEventListener("install", () => {
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const names = await caches.keys();
			await Promise.all(names.filter((n) => n.startsWith("firefly-") && !KNOWN_CACHES.includes(n)).map((n) => caches.delete(n)));
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

async function cacheFirst(request, cacheName) {
	const cache = await caches.open(cacheName);
	const hit = await cache.match(request);
	if (hit) return hit;
	const response = await fetch(request);
	if (response && response.ok && response.type === "basic") {
		cache.put(request, response.clone());
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
	if (CACHE_FIRST_PREFIXES.some((p) => url.pathname.startsWith(p))) {
		event.respondWith(cacheFirst(request, STATIC_CACHE));
		return;
	}
	event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});
