<script lang="ts">
	import { onMount } from "svelte";

	type Draft = {
		id: string;
		title?: string;
		slug?: string;
		published?: string;
		updated?: string | null;
		description?: string;
		ai_summary?: string;
		image?: string;
		tags?: string[];
		tags_json?: string;
		category?: string;
		lang?: string;
		pinned?: number | boolean;
		author?: string;
		source_link?: string;
		license_name?: string;
		license_url?: string;
		comment?: number | boolean;
		content?: string;
		status?: "draft" | "published";
		updated_at?: string;
		created_at?: string;
		github_path?: string | null;
		github_sha?: string | null;
		commit_sha?: string | null;
	};

	type MediaAsset = {
		id: string;
		object_key: string;
		public_url: string;
		filename: string;
		mime_type: string;
		size: number;
		created_at: string;
	};

	type MediaRecord = Record<string, unknown>;

	type Section = "dashboard" | "posts" | "media" | "pages" | "settings" | "security";
	type Props = { initialView?: "login" | "app" };
	let { initialView = "app" }: Props = $props();

	const navigation: { id: Section; label: string; icon: string }[] = [
		{ id: "dashboard", label: "仪表盘", icon: "⌂" },
		{ id: "posts", label: "文章", icon: "✎" },
		{ id: "media", label: "媒体库", icon: "▧" },
		{ id: "pages", label: "页面", icon: "▤" },
		{ id: "settings", label: "设置", icon: "⚙" },
		{ id: "security", label: "安全", icon: "◇" },
	];

	let authenticated = $state(initialView === "app");
	let activeSection = $state<Section>("dashboard");
	let drawerOpen = $state(false);
	let drafts = $state<Draft[]>([]);
	let media = $state<MediaAsset[]>([]);
	let selectedId = $state<string | null>(null);
	let title = $state("");
	let slug = $state("");
	let published = $state("");
	let updated = $state("");
	let description = $state("");
	let aiSummary = $state("");
	let image = $state("");
	let tags = $state("");
	let category = $state("");
	let lang = $state("");
	let pinned = $state(false);
	let author = $state("");
	let sourceLink = $state("");
	let licenseName = $state("");
	let licenseUrl = $state("");
	let comment = $state(true);
	let content = $state("");
	let username = $state("");
	let password = $state("");
	let csrfToken = $state("");
	let loading = $state(true);
	let draftsLoading = $state(false);
	let mediaLoading = $state(false);
	let mediaLoaded = $state(false);
	let mediaUnavailable = $state(false);
	let saving = $state(false);
	let deleting = $state(false);
	let uploading = $state(false);
	let uploadProgress = $state(0);
	let uploadStatus = $state("");
	let dragActive = $state(false);
	let mediaInput = $state<HTMLInputElement>();
	let loggingIn = $state(false);
	let showPassword = $state(false);
	let error = $state("");
	let notice = $state("");
	let mediaError = $state("");
	let editorMode = $state<"write" | "preview">("write");
	let savedSnapshot = $state("");
	let lastSavedAt = $state("");
	let editorElement = $state<HTMLTextAreaElement>();

	const selectedDraft = $derived(drafts.find((draft) => draft.id === selectedId));
	const isNew = $derived(selectedId === null);
	const draftCount = $derived(drafts.filter((draft) => draft.status !== "published").length);
	const publishedCount = $derived(drafts.filter((draft) => draft.status === "published").length);
	const latestSaved = $derived(drafts[0]?.updated_at || drafts[0]?.created_at || "");
	const editorSnapshot = $derived(JSON.stringify({ title, slug, published, updated, description, aiSummary, image, tags, category, lang, pinned, author, sourceLink, licenseName, licenseUrl, comment, content }));
	const isDirty = $derived(editorSnapshot !== savedSnapshot);
	const previewText = $derived(renderPlainText(content));
	const sectionTitle = $derived(navigation.find((item) => item.id === activeSection)?.label || "后台");

	function parseTags(value: string | undefined) {
		if (!value) return "";
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed.filter((tag) => typeof tag === "string").join(", ") : "";
		} catch {
			return "";
		}
	}

	function slugify(value: string) {
		return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `draft-${Date.now()}`;
	}

	function renderPlainText(value: string) {
		return value
			.replace(/!\[([^\]]*)\]\([^)]*\)/g, "[图片：$1]")
			.replace(/\*\*(.+?)\*\*/g, "$1")
			.replace(/__(.+?)__/g, "$1")
			.replace(/`([^`]+)`/g, "$1")
			.replace(/^#{1,6}\s+/gm, "")
			.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
	}

	function formatDate(value: string, includeTime = false) {
		if (!value) return "暂无记录";
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return value;
		return new Intl.DateTimeFormat("zh-CN", includeTime ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } : { year: "numeric", month: "short", day: "numeric" }).format(date);
	}

	function formatSavedAt(value: string) {
		if (!value) return "尚未保存";
		return formatDate(value, true);
	}

	function formatSize(value: number) {
		if (value < 1024) return `${value} B`;
		if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
		return `${(value / 1024 / 1024).toFixed(1)} MB`;
	}

	function normalizeMediaAsset(value: MediaRecord): MediaAsset {
		const objectKey = typeof value.object_key === "string" ? value.object_key : typeof value.objectKey === "string" ? value.objectKey : typeof value.key === "string" ? value.key : "";
		const key = objectKey.replace(/^\/+/, "").replace(/^media\//, "");
		const publicUrl = typeof value.public_url === "string" ? value.public_url : typeof value.publicUrl === "string" ? value.publicUrl : typeof value.url === "string" ? value.url : `/media/${key}`;
		return {
			id: String(value.id || key),
			object_key: objectKey,
			public_url: publicUrl.replace(/\/media\/media\//, "/media/"),
			filename: String(value.filename || value.name || key),
			mime_type: String(value.mime_type || value.mimeType || value.type || "image/*"),
			size: Number(value.size || value.bytes || 0),
			created_at: String(value.created_at || value.createdAt || ""),
		};
	}

	function mediaUrl(asset: MediaAsset) {
		return asset.public_url || `/media/${asset.object_key.replace(/^\/+/, "").replace(/^media\//, "")}`;
	}

	function markEditorSaved() {
		savedSnapshot = editorSnapshot;
		lastSavedAt = new Date().toISOString();
	}

	function getErrorMessage(data: Record<string, unknown>, fallback: string) {
		const code = typeof data.error === "string" ? data.error : "";
		const messages: Record<string, string> = {
			media_unavailable: "媒体库暂不可用。当前环境未配置 R2 存储，不影响文章编辑与发布。",
			invalid_file: "请选择有效的图片文件。",
			invalid_media_type: "仅支持 PNG、JPG、WebP 和 GIF 图片。",
			invalid_media_signature: "图片内容与文件类型不匹配。",
			payload_too_large: "图片不能超过 10 MB。",
			media_upload_failed: "图片上传失败，请稍后重试。",
			media_delete_failed: "媒体删除失败，请稍后重试。",
		};
		return messages[code] || (typeof data.message === "string" ? data.message : code || fallback);
	}

	async function request(path: string, options: RequestInit = {}) {
		const response = await fetch(path, {
			...options,
			credentials: "same-origin",
			headers: {
				"Content-Type": "application/json",
				...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
				...(options.headers || {}),
			},
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(getErrorMessage(data, "请求失败"));
		return data;
	}

	async function loadCsrf() {
		const data = await request("/api/admin/csrf", { headers: {} });
		csrfToken = typeof data.csrfToken === "string" ? data.csrfToken : "";
	}

	async function loadSession() {
		try {
			const data = await request("/api/admin/session", { headers: {} });
			authenticated = Boolean(data.authenticated ?? data.ok ?? data.session);
		} catch {
			authenticated = false;
		} finally {
			loading = false;
		}
		if (authenticated) await loadDrafts();
	}

	async function loadDrafts() {
		draftsLoading = true;
		error = "";
		try {
			const data = await request("/api/admin/drafts", { headers: {} });
			drafts = data.drafts || data.items || (Array.isArray(data) ? data : []);
			if (selectedId && !drafts.some((draft) => draft.id === selectedId)) selectDraft(null);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "文章加载失败";
		} finally {
			draftsLoading = false;
		}
	}

	async function loadMedia() {
		mediaLoading = true;
		mediaError = "";
		mediaUnavailable = false;
		try {
			const data = await request("/api/admin/media", { headers: {} });
			const records = Array.isArray(data.media) ? data.media : Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : [];
			media = records.filter((item): item is MediaRecord => Boolean(item && typeof item === "object")).map(normalizeMediaAsset);
			mediaLoaded = true;
		} catch (cause) {
			mediaError = cause instanceof Error ? cause.message : "媒体加载失败";
			mediaUnavailable = mediaError.includes("R2") || mediaError.includes("暂不可用");
			mediaLoaded = true;
		} finally {
			mediaLoading = false;
		}
	}

	function navigate(section: Section) {
		activeSection = section;
		drawerOpen = false;
		error = "";
		notice = "";
		if (section === "media" && !mediaLoaded) loadMedia();
	}

	function selectDraft(id: string | null) {
		selectedId = id;
		const draft = drafts.find((item) => item.id === id);
		title = draft?.title || "";
		slug = draft?.slug || "";
		published = draft?.published || new Date().toISOString().slice(0, 10);
		updated = draft?.updated || "";
		description = draft?.description || "";
		aiSummary = draft?.ai_summary || "";
		image = draft?.image || "";
		tags = draft?.tags?.join(", ") || parseTags(draft?.tags_json);
		category = draft?.category || "";
		lang = draft?.lang || "zh-CN";
		pinned = draft?.pinned === true || draft?.pinned === 1;
		author = draft?.author || "";
		sourceLink = draft?.source_link || "";
		licenseName = draft?.license_name || "";
		licenseUrl = draft?.license_url || "";
		comment = draft?.comment !== false && draft?.comment !== 0;
		content = draft?.content ?? "";
		editorMode = "write";
		lastSavedAt = draft?.updated_at || draft?.created_at || "";
		error = "";
		notice = "";
		setTimeout(markEditorSaved, 0);
	}

	function openEditor(id: string | null) {
		selectDraft(id);
		navigate("posts");
	}

	async function login() {
		if (loggingIn) return;
		loggingIn = true;
		error = "";
		try {
			await request("/api/admin/login", { method: "POST", body: JSON.stringify({ username, password }) });
			password = "";
			authenticated = true;
			csrfToken = "";
			await loadCsrf();
			await loadDrafts();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "登录失败";
		} finally {
			loggingIn = false;
		}
	}

	async function saveDraft() {
		saving = true;
		error = "";
		notice = "";
		try {
			if (!csrfToken) await loadCsrf();
			const normalizedSlug = slug.trim() || slugify(title);
			slug = normalizedSlug;
			const payload = JSON.stringify({
				title: title.trim(),
				slug: normalizedSlug,
				published: published || new Date().toISOString().slice(0, 10),
				updated: updated || undefined,
				description: description.trim(),
				aiSummary: aiSummary.trim(),
				image: image.trim(),
				tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
				category: category.trim(),
				lang: lang.trim() || "zh-CN",
				pinned,
				author: author.trim(),
				sourceLink: sourceLink.trim(),
				licenseName: licenseName.trim(),
				licenseUrl: licenseUrl.trim(),
				comment,
				content,
			});
			const data = await request(isNew ? "/api/admin/drafts" : `/api/admin/drafts/${encodeURIComponent(selectedId || "")}`, {
				method: isNew ? "POST" : "PUT",
				body: payload,
			});
			const draft = data.draft || data;
			if (isNew && draft.id) selectedId = draft.id;
			markEditorSaved();
			notice = "文章已安全保存";
			await loadDrafts();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "保存失败";
		} finally {
			saving = false;
		}
	}

	async function publishDraft() {
		if (!selectedId || !selectedDraft || !window.confirm(`确定发布“${selectedDraft.title || "无标题"}”到 GitHub 吗？发布后将进入正式文章目录。`)) return;
		error = "";
		notice = "";
		saving = true;
		try {
			if (!csrfToken) await loadCsrf();
			const data = await request(`/api/admin/drafts/${encodeURIComponent(selectedId)}/publish`, {
				method: "POST",
				body: JSON.stringify({ githubSha: selectedDraft.github_sha ?? null }),
			});
			notice = data.path ? `已发布：${data.path}` : "文章已发布";
			await loadDrafts();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "发布失败";
		} finally {
			saving = false;
		}
	}

	async function deleteDraft() {
		if (!selectedId || !window.confirm("确定删除这篇草稿吗？此操作不可撤销。")) return;
		deleting = true;
		error = "";
		try {
			if (!csrfToken) await loadCsrf();
			await request(`/api/admin/drafts/${encodeURIComponent(selectedId)}`, { method: "DELETE" });
			selectDraft(null);
			await loadDrafts();
			notice = "草稿已删除";
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "删除失败";
		} finally {
			deleting = false;
		}
	}

	async function uploadMedia(file: File) {
		if (!file || uploading) return;
		uploading = true;
		uploadProgress = 0;
		uploadStatus = "准备上传";
		mediaError = "";
		notice = "";
		try {
			if (!csrfToken) await loadCsrf();
			const form = new FormData();
			form.append("file", file);
			const response = await new Promise<{ response: Response; data: Record<string, unknown> }>((resolve, reject) => {
				const xhr = new XMLHttpRequest();
				xhr.open("POST", "/api/admin/media");
				xhr.withCredentials = true;
				xhr.setRequestHeader("X-CSRF-Token", csrfToken);
				xhr.upload.onprogress = (event) => {
					if (event.lengthComputable) uploadProgress = Math.round((event.loaded / event.total) * 100);
					uploadStatus = `上传中 ${uploadProgress}%`;
				};
				xhr.onerror = () => reject(new Error("图片上传失败，请检查网络连接。"));
				xhr.onload = () => {
					const data = JSON.parse(xhr.responseText || "{}");
					resolve({ response: new Response(xhr.responseText, { status: xhr.status }), data });
				};
				xhr.send(form);
			});
			if (!response.response.ok) throw new Error(getErrorMessage(response.data, "图片上传失败"));
			notice = `已上传 ${file.name}`;
		uploadStatus = "上传完成";
		uploadProgress = 100;
			mediaUnavailable = false;
			await loadMedia();
		} catch (cause) {
			mediaError = cause instanceof Error ? cause.message : "图片上传失败";
			uploadStatus = "上传失败";
			mediaUnavailable = mediaError.includes("R2") || mediaError.includes("暂不可用");
		} finally {
			uploading = false;
		}
	}

	function uploadFromInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (file) uploadMedia(file);
		input.value = "";
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		dragActive = false;
		const file = event.dataTransfer?.files?.[0];
		if (file) uploadMedia(file);
	}

	function handlePaste(event: ClipboardEvent) {
		if (activeSection !== "media" || uploading) return;
		const file = Array.from(event.clipboardData?.files || []).find((item) => item.type.startsWith("image/"));
		if (file) {
			event.preventDefault();
			uploadMedia(file);
		}
	}


	async function deleteMedia(asset: MediaAsset) {
		if (!window.confirm(`确定删除“${asset.filename}”吗？文章中已使用的图片可能会失效，此操作不可撤销。`)) return;
		mediaError = "";
		try {
			if (!csrfToken) await loadCsrf();
			await request(`/api/admin/media/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
			notice = `已删除 ${asset.filename}`;
			await loadMedia();
		} catch (cause) {
			mediaError = cause instanceof Error ? cause.message : "媒体删除失败";
		}
	}

	function setCover(asset: MediaAsset) {
		image = mediaUrl(asset);
		notice = `已将 ${asset.filename} 设为当前文章封面`;
	}

	async function copyMediaMarkdown(asset: MediaAsset) {
		try {
			await navigator.clipboard.writeText(`![${asset.filename}](${mediaUrl(asset)})`);
			notice = `已复制 ${asset.filename} 的 Markdown`;
		} catch {
			mediaError = "复制失败，请检查浏览器剪贴板权限。";
		}
	}

	function insertMedia(asset: MediaAsset) {
		const syntax = `![${asset.filename}](${mediaUrl(asset)})`;
		const start = editorElement?.selectionStart ?? content.length;
		const end = editorElement?.selectionEnd ?? start;
		const prefix = start > 0 && content[start - 1] !== "\n" ? "\n\n" : "";
		const suffix = end < content.length && content[end] !== "\n" ? "\n\n" : "";
		content = `${content.slice(0, start)}${prefix}${syntax}${suffix}${content.slice(end)}`;
		editorMode = "write";
		notice = `已插入 ${asset.filename} 的 Markdown 图片语法`;
		setTimeout(() => editorElement?.focus(), 0);
	}

	async function logout() {
		try {
			await request("/api/admin/logout", { method: "POST", body: JSON.stringify({ csrfToken }) });
		} finally {
			password = "";
			csrfToken = "";
			authenticated = false;
		}
	}

	onMount(() => {
		document.addEventListener("paste", handlePaste);
		loadCsrf().catch(() => {});
		if (initialView === "app") loadSession();
		else loading = false;
		return () => document.removeEventListener("paste", handlePaste);
	});
</script>

<svelte:head><title>{authenticated ? `${sectionTitle} · 写作后台` : "管理员登录"}</title></svelte:head>

{#if loading}
	<main class="admin-shell admin-loading"><span class="admin-spinner"></span><p>正在验证安全会话…</p></main>
{:else if !authenticated}
	<main class="admin-shell admin-login-shell">
		<div class="admin-login-backdrop" aria-hidden="true"><span></span><span></span><span></span></div>
		<section class="admin-login admin-panel">
			<a class="admin-login-back" href="/" aria-label="返回 Nevino's blog"><span aria-hidden="true">←</span> 返回博客</a>
			<div class="admin-login-brand"><div class="admin-login-avatar"><img src="/assets/Avater.png" alt="" /></div><div><span class="admin-login-brand-name">Nevino's blog</span><span class="admin-login-brand-subtitle">PERSONAL WRITING SPACE</span></div></div>
			<div class="admin-login-heading"><p class="admin-kicker">PRIVATE ACCESS / 01</p><h1>欢迎回来</h1><p class="admin-muted">登录后管理文章与媒体，继续写下下一段想法。</p></div>
			<form class="admin-login-form" onsubmit={(event) => { event.preventDefault(); login(); }}>
				<label for="username">用户名<input id="username" bind:value={username} autocomplete="username" placeholder="输入管理员用户名" required /></label>
				<label for="password">密码<div class="admin-password-field"><input id="password" type={showPassword ? "text" : "password"} bind:value={password} autocomplete="current-password" placeholder="输入管理员密码" required /><button type="button" class="admin-password-toggle" aria-label={showPassword ? "隐藏密码" : "显示密码"} onclick={() => showPassword = !showPassword}>{showPassword ? "隐藏" : "显示"}</button></div></label>
				<button class="admin-button admin-button-primary admin-login-submit" type="submit" disabled={loggingIn}>{#if loggingIn}<span class="admin-button-spinner" aria-hidden="true"></span>正在验证…{:else}进入写作后台<span aria-hidden="true">→</span>{/if}</button>
			</form>
			{#if error}<div class="admin-login-error" role="alert"><span aria-hidden="true">!</span><span>{error}</span></div>{/if}
			<div class="admin-login-security"><span class="admin-security-icon" aria-hidden="true">⌁</span><div><strong>安全连接</strong><span>密码仅用于本次验证，不会保存到浏览器。</span></div></div>
		</section>
		<p class="admin-login-footer">Nevino's blog <span>·</span> WRITE SOMETHING TRUE</p>
	</main>
{:else}
	<main class="admin-shell admin-app-shell">
		<button class:open={drawerOpen} class="admin-drawer-backdrop" aria-label="关闭导航" onclick={() => drawerOpen = false}></button>
		<aside class:open={drawerOpen} class="admin-app-nav">
			<a class="admin-app-brand" href="/"><span class="admin-brand-mark">N</span><span><strong>Nevino's blog</strong><small>写作后台</small></span></a>
			<nav aria-label="后台导航">
				{#each navigation as item}
					<button class:active={activeSection === item.id} onclick={() => navigate(item.id)}><span aria-hidden="true">{item.icon}</span>{item.label}</button>
				{/each}
			</nav>
			<div class="admin-nav-foot"><span class="admin-session-status"><span class="admin-status-dot"></span>安全会话已连接</span><a href="/">查看博客 <span aria-hidden="true">↗</span></a><button onclick={logout}>退出登录</button></div>
		</aside>

		<div class="admin-app-main">
			<header class="admin-topbar">
				<div class="admin-topbar-title"><button class="admin-menu-button" aria-label="打开导航" aria-expanded={drawerOpen} onclick={() => drawerOpen = !drawerOpen}>☰</button><div><p class="admin-kicker">FIREFLY / ADMIN</p><h1>{sectionTitle}</h1></div></div>
				<div class="admin-topbar-actions"><button class="admin-button admin-button-ghost" onclick={() => openEditor(null)}>＋ 新建文章</button><span class="admin-avatar"><img src="/assets/Avater.png" alt="管理员" /></span></div>
			</header>

			<div class="admin-mobile-tabs" aria-label="后台区域">
				{#each navigation.slice(0, 3) as item}<button class:active={activeSection === item.id} onclick={() => navigate(item.id)}>{item.label}</button>{/each}
			</div>

			{#if error}<div class="admin-alert admin-error" role="alert"><span>!</span>{error}<button aria-label="关闭" onclick={() => error = ""}>×</button></div>{/if}
			{#if notice}<div class="admin-alert admin-notice" role="status"><span>✓</span>{notice}<button aria-label="关闭" onclick={() => notice = ""}>×</button></div>{/if}

			{#if activeSection === "dashboard"}
				<section class="admin-view">
					<div class="admin-welcome"><div><p class="admin-kicker">OVERVIEW</p><h2>欢迎回来，继续记录今天。</h2><p>这里汇总了写作与媒体状态，让每次更新都有清晰的起点。</p></div><button class="admin-button admin-button-primary" onclick={() => openEditor(null)}>开始写作</button></div>
					<div class="admin-stats">
						<article><span class="admin-stat-icon">✎</span><div><small>草稿</small><strong>{draftsLoading ? "—" : draftCount}</strong><p>等待继续完善</p></div></article>
						<article><span class="admin-stat-icon admin-stat-green">✓</span><div><small>已发布</small><strong>{draftsLoading ? "—" : publishedCount}</strong><p>来自后台记录</p></div></article>
						<article><span class="admin-stat-icon admin-stat-gold">▧</span><div><small>媒体</small><strong>{mediaLoaded && !mediaUnavailable ? media.length : "—"}</strong><p>{mediaUnavailable ? "R2 尚未配置" : mediaLoaded ? "可用图片资源" : "进入媒体库加载"}</p></div></article>
						<article><span class="admin-stat-icon admin-stat-purple">◷</span><div><small>最近保存</small><strong class="admin-stat-time">{latestSaved ? formatDate(latestSaved, true) : "暂无"}</strong><p>最新编辑记录</p></div></article>
					</div>
					<div class="admin-dashboard-grid">
						<section class="admin-panel admin-recent"><div class="admin-card-head"><div><p class="admin-kicker">RECENT POSTS</p><h3>最近文章</h3></div><button onclick={() => navigate("posts")}>查看全部 →</button></div>
							{#if draftsLoading}<div class="admin-state"><span class="admin-spinner"></span><p>正在加载文章…</p></div>{:else if drafts.length === 0}<div class="admin-state"><span class="admin-state-icon">✎</span><h4>还没有文章</h4><p>新建第一篇草稿，开始你的写作记录。</p><button class="admin-button admin-button-primary" onclick={() => openEditor(null)}>新建文章</button></div>{:else}<div class="admin-recent-list">{#each drafts.slice(0, 5) as draft}<button onclick={() => openEditor(draft.id)}><span class="admin-post-symbol">{draft.status === "published" ? "✓" : "✎"}</span><span><strong>{draft.title || "无标题"}</strong><small>{draft.category || "未分类"} · {formatDate(draft.updated_at || draft.created_at || "", true)}</small></span><em class:published={draft.status === "published"}>{draft.status === "published" ? "已发布" : "草稿"}</em></button>{/each}</div>{/if}
						</section>
						<aside class="admin-panel admin-quick"><div class="admin-card-head"><div><p class="admin-kicker">QUICK ACTIONS</p><h3>快捷操作</h3></div></div><button onclick={() => openEditor(null)}><span>＋</span><div><strong>新建文章</strong><small>创建一篇新的 Markdown 草稿</small></div></button><button onclick={() => navigate("media")}><span>⇧</span><div><strong>上传图片</strong><small>添加图片到媒体库</small></div></button><button onclick={() => navigate("settings")}><span>⚙</span><div><strong>站点设置</strong><small>查看当前后台配置</small></div></button></aside>
					</div>
				</section>
			{:else if activeSection === "posts"}
				<section class="admin-view admin-posts-view">
					<aside class="admin-post-list admin-panel"><div class="admin-card-head"><div><p class="admin-kicker">ALL POSTS</p><h3>文章列表</h3></div><button class="admin-button admin-button-small" onclick={() => selectDraft(null)}>新建</button></div>
						{#if draftsLoading}<div class="admin-state admin-state-small"><span class="admin-spinner"></span><p>正在加载…</p></div>{:else if drafts.length === 0}<div class="admin-state admin-state-small"><span class="admin-state-icon">✎</span><h4>暂无文章</h4><p>从一篇新草稿开始。</p></div>{:else}<nav aria-label="文章列表">{#each drafts as draft}<button class:active={draft.id === selectedId} class="admin-draft-item" onclick={() => selectDraft(draft.id)}><span><strong>{draft.title || "无标题"}</strong><em class:published={draft.status === "published"}>{draft.status === "published" ? "已发布" : "草稿"}</em></span><small>{formatDate(draft.updated_at || draft.created_at || draft.id, true)}</small></button>{/each}</nav>{/if}
					</aside>
					<section class="admin-editor admin-panel"><div class="admin-editor-head"><div><p class="admin-kicker">{isNew ? "NEW DRAFT" : "EDIT POST"}</p><h2>{isNew ? "新建文章" : (selectedDraft?.title || "编辑文章")}</h2><div class="admin-save-meta"><span class:admin-unsaved={isDirty}><span class="admin-status-dot"></span>{isDirty ? "有未保存更改" : "所有更改已保存"}</span><span>上次保存 {formatSavedAt(lastSavedAt)}</span></div></div><div class="admin-actions"><button class="admin-button admin-button-primary" disabled={saving || deleting || !title.trim()} onclick={saveDraft}>{saving ? "保存中…" : "保存"}</button>{#if !isNew}<button class="admin-button admin-button-ghost" disabled={saving || deleting || selectedDraft?.status === "published"} onclick={publishDraft}>{selectedDraft?.status === "published" ? "已发布" : "发布"}</button><button class="admin-button admin-button-danger" disabled={saving || deleting} onclick={deleteDraft}>{deleting ? "删除中…" : "删除"}</button>{/if}</div></div>
						<div class="admin-section-heading"><div><p class="admin-kicker">METADATA</p><h3>文章信息</h3></div><span class="admin-hint">标题为必填项</span></div>
						<div class="admin-fields"><label class="admin-field-wide">标题<input bind:value={title} placeholder="文章标题" required /></label><label>Slug<input bind:value={slug} placeholder="可选，例如 my-first-post" /></label><label>语言<input bind:value={lang} placeholder="zh-CN" /></label><label>发布日期<input type="date" bind:value={published} required /></label><label>更新日期<input type="date" bind:value={updated} /></label><label class="admin-field-wide">描述<textarea bind:value={description} rows="3" placeholder="用于列表和分享卡片的文章摘要"></textarea></label><label class="admin-field-wide">AI 摘要<textarea bind:value={aiSummary} rows="3" placeholder="文章的 AI 摘要，可留空"></textarea></label><label class="admin-field-wide">封面图<div class="admin-cover-field"><input bind:value={image} placeholder="/media/cover.webp 或 https://…" /><button type="button" onclick={() => navigate("media")}>从媒体库选择</button></div></label><label>标签<input bind:value={tags} placeholder="多个标签用逗号分隔" /></label><label>分类<input bind:value={category} placeholder="文章分类" /></label><label>作者<input bind:value={author} placeholder="文章作者，可留空" /></label><label>来源链接<input type="url" bind:value={sourceLink} placeholder="https://…" /></label><label>许可名称<input bind:value={licenseName} placeholder="例如 CC BY-NC-SA 4.0" /></label><label>许可链接<input type="url" bind:value={licenseUrl} placeholder="https://…" /></label><div class="admin-field-wide admin-switches"><label class="admin-checkbox"><input type="checkbox" bind:checked={pinned} /><span>置顶文章<small>在文章列表中优先展示</small></span></label><label class="admin-checkbox"><input type="checkbox" bind:checked={comment} /><span>开启评论<small>允许读者在文章下留言</small></span></label></div></div>
						<div class="admin-section-heading admin-writing-heading"><div><p class="admin-kicker">COMPOSE</p><h3>正文内容</h3></div><span class="admin-hint">Markdown · {content.length} 字符</span></div>
						<div class="admin-editor-tabs" role="tablist" aria-label="正文编辑模式"><button class:active={editorMode === "write"} class="admin-tab" role="tab" aria-selected={editorMode === "write"} onclick={() => editorMode = "write"}>编辑</button><button class:active={editorMode === "preview"} class="admin-tab" role="tab" aria-selected={editorMode === "preview"} onclick={() => editorMode = "preview"}>纯文本预览</button><button class="admin-media-shortcut" onclick={() => navigate("media")}>插入图片</button></div>
						{#if editorMode === "write"}<label class="admin-content-label"><span class="sr-only">Markdown 原文</span><textarea bind:this={editorElement} class="admin-textarea" bind:value={content} placeholder="# 从这里开始写作…" spellcheck="false"></textarea></label><p class="admin-shortcut-hint">预览只显示纯文本，不执行 Markdown 中的 HTML 或脚本。</p>{:else}<article class="admin-preview" aria-label="纯文本安全预览">{previewText || "预览会显示在这里。"}</article>{/if}
					</section>
				</section>
			{:else if activeSection === "media"}
				<section class="admin-view"><div class="admin-view-heading"><div><p class="admin-kicker">MEDIA LIBRARY</p><h2>媒体库</h2><p>上传并管理文章中的图片资源。</p></div><label class:disabled={uploading || mediaUnavailable} class="admin-upload-button"><input bind:this={mediaInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={uploading || mediaUnavailable} onchange={uploadFromInput} />{uploading ? uploadStatus : "⇧ 选择图片"}</label></div>
					{#if mediaError}<div class:admin-unavailable={mediaUnavailable} class="admin-inline-state" role="alert"><span>{mediaUnavailable ? "◇" : "!"}</span><div><strong>{mediaUnavailable ? "媒体存储尚未启用" : "媒体库加载失败"}</strong><p>{mediaError}</p>{#if !mediaUnavailable}<button onclick={loadMedia}>重新加载</button>{/if}</div></div>{/if}
					{#if mediaLoading}<div class="admin-panel admin-state admin-state-large"><span class="admin-spinner"></span><h3>正在加载媒体库</h3><p>正在读取 R2 中的图片资源…</p></div>{:else if !mediaError && media.length === 0}<div class:admin-drop-active={dragActive} class="admin-panel admin-state admin-state-large admin-drop-zone" role="button" tabindex="0" ondragover={(event) => { event.preventDefault(); dragActive = true; }} ondragleave={() => dragActive = false} ondrop={handleDrop} onclick={() => mediaInput?.click()} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") mediaInput?.click(); }}><span class="admin-state-icon">▧</span><h3>{uploading ? uploadStatus : "媒体库还是空的"}</h3><p>{uploading ? `正在上传，已完成 ${uploadProgress}%` : "拖拽图片到这里，或点击选择；也可以直接粘贴图片。"}</p>{#if uploading}<progress max="100" value={uploadProgress}></progress>{/if}</div>{:else if media.length > 0}<div class="admin-media-grid">{#each media as asset}<article class="admin-media-card admin-panel"><div class="admin-media-image"><img src={mediaUrl(asset)} alt={asset.filename} loading="lazy" /><span>{asset.mime_type.replace("image/", "").toUpperCase()}</span></div><div class="admin-media-info"><strong title={asset.filename}>{asset.filename}</strong><small>{formatSize(asset.size)} · {formatDate(asset.created_at)}</small><code>{mediaUrl(asset)}</code><div><button onclick={() => insertMedia(asset)}>插入正文</button><button onclick={() => setCover(asset)}>设为封面</button><button onclick={() => copyMediaMarkdown(asset)}>复制 Markdown</button><button class="danger" onclick={() => deleteMedia(asset)}>删除</button></div></div></article>{/each}</div>{/if}
				</section>
			{:else if activeSection === "pages"}
				<section class="admin-view"><div class="admin-view-heading"><div><p class="admin-kicker">PAGES</p><h2>页面</h2><p>独立页面由仓库内容管理，后台不会绕过现有发布流程。</p></div></div><div class="admin-panel admin-state admin-state-large"><span class="admin-state-icon">▤</span><h3>页面管理尚未接入 API</h3><p>关于、友链与留言板等页面仍由仓库中的内容和配置驱动。现有后台协议保持不变。</p><a class="admin-button admin-button-ghost" href="/">查看站点页面</a></div></section>
			{:else if activeSection === "settings"}
				<section class="admin-view"><div class="admin-view-heading"><div><p class="admin-kicker">SETTINGS</p><h2>设置</h2><p>后台遵循 Firefly 当前的仓库配置。</p></div></div><div class="admin-settings-grid"><article class="admin-panel admin-setting-card"><span>◐</span><div><h3>外观模式</h3><p>自动跟随系统浅色或深色偏好，与博客视觉保持一致。</p></div><strong>自动</strong></article><article class="admin-panel admin-setting-card"><span>⌘</span><div><h3>内容格式</h3><p>文章正文使用 Markdown，预览始终按纯文本安全显示。</p></div><strong>Markdown</strong></article><article class="admin-panel admin-setting-card"><span>▧</span><div><h3>媒体存储</h3><p>{mediaUnavailable ? "当前环境未配置 R2，文章编辑仍可正常使用。" : "媒体功能在配置 Cloudflare R2 后可用。"}</p></div><strong>{mediaUnavailable ? "未连接" : "按需检测"}</strong></article></div></section>
			{:else}
				<section class="admin-view"><div class="admin-view-heading"><div><p class="admin-kicker">SECURITY</p><h2>安全</h2><p>查看本次后台会话采用的安全策略。</p></div></div><div class="admin-security-grid"><article class="admin-panel"><span>✓</span><div><h3>同源安全会话</h3><p>身份通过安全 Cookie 维持，不在 localStorage 中保存 token 或密码。</p></div></article><article class="admin-panel"><span>✓</span><div><h3>CSRF 防护</h3><p>保存、发布、上传与删除请求均携带当前会话的 X-CSRF-Token。</p></div></article><article class="admin-panel"><span>✓</span><div><h3>安全预览</h3><p>正文预览仅输出文本，不使用 innerHTML，也不执行用户输入的 HTML。</p></div></article></div><button class="admin-button admin-button-danger admin-security-logout" onclick={logout}>退出当前会话</button></section>
			{/if}
		</div>
	</main>
{/if}
