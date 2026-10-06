<script lang="ts">
import { marked } from "marked";
import { tick } from "svelte";
import sanitizeHtml from "sanitize-html";
import { AdminApiError, adminApi, adminRequest } from "./admin-api";
import type {
	DraftDetail,
	DraftSummary,
	DraftWrite,
	PublishTask,
} from "./admin-types";
import {
	canApplySaveResult,
	canPublishEditor,
	canReconcilePublishTask,
	canRecoverDeploymentWait,
	confirmDestructiveEditorAction,
	pollPublishTaskWithRetry,
	shouldPollPublishTask,
} from "./editor-state";
import PostDangerActions from "./PostDangerActions.svelte";
import PostHistoryPanel from "./PostHistoryPanel.svelte";

type Props = {
	resourceId: string | null;
	mediaInsert: { value: string; key: number } | null;
	mediaCover: { value: string; key: number } | null;
	onupdated: (draft: DraftDetail) => void;
	ondeleted: () => void;
	oncreated: (id: string) => void;
	onmedia: () => void;
	onerror: (message: string) => void;
	onnotice: (message: string) => void;
	ondirtychange: (dirty: boolean) => void;
};

let {
	resourceId,
	mediaInsert,
	mediaCover,
	onupdated,
	ondeleted,
	oncreated,
	onmedia,
	onerror,
	onnotice,
	ondirtychange,
}: Props = $props();
let draft = $state<DraftDetail | null>(null);
let loading = $state(false);
let saving = $state(false);
let discarding = $state(false);
let recovering = $state(false);
let reconciling = $state(false);
let editorMode = $state<"write" | "preview">("write");
let publishTask = $state<PublishTask | null>(null);
let conflict = $state(false);
let loadedId = $state<string | null | undefined>(undefined);
let title = $state("");
let slug = $state("");
let published = $state("");
let updated = $state("");
let description = $state("");
let aiSummary = $state("");
let image = $state("");
let tags = $state("");
let category = $state("");
let lang = $state("zh-CN");
let pinned = $state(false);
let author = $state("");
let sourceLink = $state("");
let licenseName = $state("");
let licenseUrl = $state("");
let comment = $state(true);
let content = $state("");
let savedSnapshot = $state("");
let lastSavedAt = $state("");
let loadSequence = 0;
let saveSequence = 0;
let publishPollSequence = 0;
let appliedInsertKey = 0;
let appliedCoverKey = 0;
let contentEl = $state<HTMLTextAreaElement | null>(null);
let pasteUpload = $state<{ active: boolean; name: string; progress: number } | null>(
	null,
);

const editorSnapshot = $derived(
	JSON.stringify({
		title,
		slug,
		published,
		updated,
		description,
		aiSummary,
		image,
		tags,
		category,
		lang,
		pinned,
		author,
		sourceLink,
		licenseName,
		licenseUrl,
		comment,
		content,
	}),
);
const isDirty = $derived(editorSnapshot !== savedSnapshot);

// 发布检查：保存前的 SEO 与内容完整度速览，纯前端静态规则
const publishChecks = $derived.by(() => {
	const checks: { level: "ok" | "warn" | "tip"; text: string }[] = [];
	const descLen = description.trim().length;
	if (!descLen)
		checks.push({ level: "warn", text: "缺少描述：文章列表与分享卡片将没有摘要" });
	else if (descLen < 40)
		checks.push({
			level: "tip",
			text: `描述仅 ${descLen} 字，建议写到 80 字上下，搜索结果展示更完整`,
		});
	else if (descLen > 160)
		checks.push({
			level: "tip",
			text: `描述 ${descLen} 字偏长，分享卡片可能被截断，建议控制在 160 字内`,
		});
	if (!tags.trim())
		checks.push({ level: "warn", text: "还没有标签：标签页与站内检索依赖它" });
	if (!category.trim()) checks.push({ level: "tip", text: "未设置分类" });
	if (!image.trim())
		checks.push({ level: "tip", text: "未设置封面：列表将回退到默认样式" });
	const chars = content.trim().length;
	const minutes = Math.max(1, Math.round(chars / 400));
	if (chars < 300)
		checks.push({ level: "warn", text: `正文仅 ${chars} 字符，内容偏短` });
	checks.push({ level: "ok", text: `正文 ${chars} 字符 · 预计阅读约 ${minutes} 分钟` });
	return checks;
});

// 预览经 sanitize-html 白名单过滤，脚本/事件属性/iframe 一律剔除
const PREVIEW_SANITIZE_OPTIONS = {
	allowedTags: [
		...sanitizeHtml.defaults.allowedTags,
		"img",
		"del",
		"ins",
	],
	allowedAttributes: {
		...sanitizeHtml.defaults.allowedAttributes,
		img: ["src", "alt", "title", "loading"],
		a: ["href", "name", "target", "rel", "title"],
		code: ["class"],
		span: ["class"],
		pre: ["class"],
		th: ["align"],
		td: ["align"],
	},
	allowedSchemes: ["http", "https", "mailto"],
	transformTags: {
		a: sanitizeHtml.simpleTransform("a", {
			target: "_blank",
			rel: "noopener noreferrer",
		}),
	},
} satisfies sanitizeHtml.IOptions;

const previewHtml = $derived(
	editorMode === "preview"
		? sanitizeHtml(marked.parse(content, { async: false }), PREVIEW_SANITIZE_OPTIONS)
		: "",
);
const previewAvailable = $derived(content.trim().length > 0);

// 本地编辑快照：未保存更改防抖落盘，浏览器崩溃/断电后可恢复
const LOCAL_DRAFT_PREFIX = "firefly-editor-snapshot:";
const localDraftKey = $derived(`${LOCAL_DRAFT_PREFIX}${resourceId ?? "new"}`);
let localDraftReady = $state(false);

$effect(() => {
	ondirtychange(isDirty);
});
const isNew = $derived(resourceId === null);
const publishBusy = $derived(
	publishTask ? shouldPollPublishTask(publishTask.status) : false,
);

function slugify(value: string) {
	return (
		value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || `draft-${Date.now()}`
	);
}

function formatSavedAt(value: string) {
	if (!value) return "尚未保存";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat("zh-CN", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(date);
}

function applyDraft(value: DraftDetail | null) {
	draft = value;
	title = value?.title || "";
	slug = value?.slug || "";
	published = value?.published || new Date().toISOString().slice(0, 10);
	updated = value?.updated || "";
	description = value?.description || "";
	aiSummary = value?.aiSummary || "";
	image = value?.image || "";
	tags = value?.tags.join(", ") || "";
	category = value?.category || "";
	lang = value?.lang || "zh-CN";
	pinned = value?.pinned === true;
	author = value?.author || "";
	sourceLink = value?.sourceLink || "";
	licenseName = value?.licenseName || "";
	licenseUrl = value?.licenseUrl || "";
	comment = value?.comment !== false;
	content = value?.content || "";
	savedSnapshot = JSON.stringify({
		title,
		slug,
		published,
		updated,
		description,
		aiSummary,
		image,
		tags,
		category,
		lang,
		pinned,
		author,
		sourceLink,
		licenseName,
		licenseUrl,
		comment,
		content,
	});
	lastSavedAt = value?.updatedAt || value?.createdAt || "";
	publishTask = value?.publishTask ?? null;
	conflict = false;
	editorMode = "write";
}

async function loadDraft(id: string) {
	const sequence = ++loadSequence;
	loading = true;
	try {
		const value = await adminRequest<DraftDetail>(
			`/drafts/${encodeURIComponent(id)}`,
		);
		if (sequence === loadSequence) {
			applyDraft(value);
			if (value.publishTask && shouldPollPublishTask(value.publishTask.status))
				void pollPublishTask(value.publishTask.id);
		}
	} catch (cause) {
		if (sequence === loadSequence)
			onerror(cause instanceof Error ? cause.message : "文章详情加载失败");
	} finally {
		if (sequence === loadSequence) loading = false;
	}
}

$effect(() => {
	if (resourceId === loadedId) return;
	loadedId = resourceId;
	saveSequence += 1;
	saving = false;
	if (resourceId) loadDraft(resourceId);
	else {
		loadSequence += 1;
		loading = false;
		applyDraft(null);
	}
});

$effect(() => {
	if (!mediaInsert || mediaInsert.key === appliedInsertKey) return;
	appliedInsertKey = mediaInsert.key;
	content = `${content}${content && !content.endsWith("\n") ? "\n\n" : ""}${mediaInsert.value}`;
	editorMode = "write";
});

// 粘贴/拖拽图片：直接上传媒体库并在光标处插入 Markdown，免去先去媒体库再取链接
const insertAtCursor = (snippet: string) => {
	const el = contentEl;
	if (!el) {
		content = `${content}${content && !content.endsWith("\n") ? "\n\n" : ""}${snippet}`;
		return;
	}
	const start = el.selectionStart ?? content.length;
	const end = el.selectionEnd ?? start;
	content = content.slice(0, start) + snippet + content.slice(end);
	void tick().then(() => {
		el.focus();
		const pos = start + snippet.length;
		el.setSelectionRange(pos, pos);
	});
};

const extractImageFile = (files: FileList | null | undefined): File | null => {
	if (!files) return null;
	for (const file of Array.from(files)) {
		if (file.type.startsWith("image/")) return file;
	}
	return null;
};

const uploadInlineImage = async (file: File) => {
	if (pasteUpload?.active) {
		onnotice("已有图片在上传中，请稍候");
		return;
	}
	if (file.size > 20 * 1024 * 1024) {
		onerror("图片超过 20MB 上限，请压缩后再试");
		return;
	}
	const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
	const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
	const named =
		file.name && file.name !== "image.png" ? file.name : `paste-${stamp}.${ext}`;
	pasteUpload = { active: true, name: named, progress: 0 };
	try {
		const csrfToken = await adminApi.loadCsrf();
		const form = new FormData();
		form.append("file", file, named);
		const url = await new Promise<string>((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			xhr.open("POST", "/api/admin/media");
			xhr.withCredentials = true;
			xhr.setRequestHeader("X-CSRF-Token", csrfToken);
			xhr.upload.onprogress = (event) => {
				if (event.lengthComputable && pasteUpload)
					pasteUpload.progress = Math.round((event.loaded / event.total) * 100);
			};
			xhr.onerror = () => reject(new Error("图片上传失败，请检查网络连接"));
			xhr.onload = () => {
				if (xhr.status >= 200 && xhr.status < 300) {
					try {
						const body = JSON.parse(xhr.responseText || "{}") as {
							media?: { public_url?: string };
						};
						const publicUrl = body.media?.public_url;
						if (!publicUrl) throw new Error("上传响应缺少资源地址");
						resolve(publicUrl);
					} catch (cause) {
						reject(cause instanceof Error ? cause : new Error("上传响应解析失败"));
					}
				} else {
					let message = "图片上传失败";
					try {
						const body = JSON.parse(xhr.responseText || "{}") as { message?: string };
						message = body.message || message;
					} catch {
						/* 保留默认消息 */
					}
					reject(new Error(message));
				}
			};
			xhr.send(form);
		});
		insertAtCursor(`![${named}](${url})`);
		onnotice(`图片已上传并插入：${named}`);
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "图片上传失败");
	} finally {
		pasteUpload = null;
	}
};

const handleContentPaste = (event: ClipboardEvent) => {
	const file = extractImageFile(event.clipboardData?.files);
	if (!file) return;
	event.preventDefault();
	void uploadInlineImage(file);
};

const handleContentDragOver = (event: DragEvent) => {
	if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
};

const handleContentDrop = (event: DragEvent) => {
	const file = extractImageFile(event.dataTransfer?.files);
	if (!file) return;
	event.preventDefault();
	void uploadInlineImage(file);
};

$effect(() => {
	if (!mediaCover || mediaCover.key === appliedCoverKey) return;
	appliedCoverKey = mediaCover.key;
	image = mediaCover.value;
});

// 首次加载完成后，检查是否有崩溃/断电留下的本地快照，询问是否恢复
$effect(() => {
	if (loading || localDraftReady) return;
	localDraftReady = true;
	try {
		const raw = localStorage.getItem(localDraftKey);
		if (!raw) return;
		if (raw === savedSnapshot) {
			localStorage.removeItem(localDraftKey);
			return;
		}
		const restored = JSON.parse(raw) as Record<string, unknown>;
		if (!window.confirm("检测到上次未保存的本地编辑快照，是否恢复到编辑器？\n（选择取消将丢弃该快照）")) {
			localStorage.removeItem(localDraftKey);
			return;
		}
		title = String(restored.title ?? "");
		slug = String(restored.slug ?? "");
		published = String(restored.published ?? published);
		updated = String(restored.updated ?? "");
		description = String(restored.description ?? "");
		aiSummary = String(restored.aiSummary ?? "");
		image = String(restored.image ?? "");
		tags = String(restored.tags ?? "");
		category = String(restored.category ?? "");
		lang = String(restored.lang ?? "zh-CN");
		pinned = restored.pinned === true;
		author = String(restored.author ?? "");
		sourceLink = String(restored.sourceLink ?? "");
		licenseName = String(restored.licenseName ?? "");
		licenseUrl = String(restored.licenseUrl ?? "");
		comment = restored.comment !== false;
		content = String(restored.content ?? "");
		onnotice("已恢复本地编辑快照，记得保存");
	} catch {
		// 快照损坏时静默丢弃，不影响正常编辑
		try {
			localStorage.removeItem(localDraftKey);
		} catch {}
	}
});

// 有未保存更改时防抖写入本地快照；保存成功（isDirty 变 false）后清除
$effect(() => {
	if (!localDraftReady) return;
	if (!isDirty) {
		localStorage.removeItem(localDraftKey);
		return;
	}
	const snapshot = editorSnapshot;
	const timer = setTimeout(() => {
		try {
			localStorage.setItem(localDraftKey, snapshot);
		} catch {}
	}, 1500);
	return () => clearTimeout(timer);
});

function handleEditorKeydown(event: KeyboardEvent) {
	if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s")
		return;
	event.preventDefault();
	if (loading || saving || !isDirty) return;
	if (draft && !draft.capabilities.editable) return;
	void saveDraft();
}

function payload(): DraftWrite {
	const normalizedSlug = slug.trim() || slugify(title);
	slug = normalizedSlug;
	return {
		title: title.trim(),
		slug: normalizedSlug,
		published: published || new Date().toISOString().slice(0, 10),
		...(updated ? { updated } : {}),
		description: description.trim(),
		aiSummary: aiSummary.trim(),
		image: image.trim(),
		tags: tags
			.split(",")
			.map((tag) => tag.trim())
			.filter(Boolean),
		category: category.trim(),
		lang: lang.trim() || "zh-CN",
		pinned,
		author: author.trim(),
		sourceLink: sourceLink.trim(),
		licenseName: licenseName.trim(),
		licenseUrl: licenseUrl.trim(),
		comment,
		content,
		...(draft ? { version: draft.version } : {}),
	};
}

async function saveDraft() {
	const sequence = ++saveSequence;
	const requestResourceId = resourceId;
	const body = payload();
	const requestSnapshot = editorSnapshot;
	saving = true;
	conflict = false;
	try {
		const value = await adminRequest<DraftDetail>(
			requestResourceId
				? `/drafts/${encodeURIComponent(requestResourceId)}`
				: "/drafts",
			{
				method: requestResourceId ? "PUT" : "POST",
				body: JSON.stringify(body),
			},
		);
		if (
			!canApplySaveResult(
				{ resourceId: requestResourceId, sequence, snapshot: requestSnapshot },
				{ resourceId, sequence: saveSequence, snapshot: editorSnapshot },
			)
		)
			return;
		applyDraft(value);
		onupdated(value);
		onnotice("文章已安全保存");
		if (!requestResourceId) oncreated(value.id);
	} catch (cause) {
		if (sequence !== saveSequence || requestResourceId !== resourceId) return;
		if (
			cause instanceof AdminApiError &&
			cause.code === "content_version_conflict"
		) {
			conflict = true;
			onerror("文章已在其他位置更新，请重新加载最新版本后再保存。");
		} else onerror(cause instanceof Error ? cause.message : "保存失败");
	} finally {
		if (sequence === saveSequence) saving = false;
	}
}

async function pollPublishTask(taskId: string) {
	const sequence = ++publishPollSequence;
	const task = await pollPublishTaskWithRetry(
		() =>
			adminRequest<PublishTask>(`/publish-tasks/${encodeURIComponent(taskId)}`),
		(milliseconds) =>
			new Promise((resolve) => setTimeout(resolve, milliseconds)),
		{ isActive: () => sequence === publishPollSequence },
	);
	if (task && sequence === publishPollSequence) publishTask = task;
}

async function publishDraft() {
	if (!canPublishEditor(isDirty, publishBusy, draft !== null)) {
		if (isDirty) onerror("请先保存当前更改，再发起发布。");
		return;
	}
	if (
		!draft ||
		!window.confirm(
			`确定发布“${draft.title || "无标题"}”到 GitHub 吗？发布后将进入正式文章目录。`,
		)
	)
		return;
	saving = true;
	try {
		publishTask = await adminRequest<PublishTask>(
			`/drafts/${encodeURIComponent(draft.id)}/publish`,
			{
				method: "POST",
				body: JSON.stringify({
					idempotencyKey: crypto.randomUUID(),
					expectedVersion: draft.version,
				}),
			},
		);
		onnotice(
			publishTask.status === "reconciliation_required"
				? "GitHub 已提交，数据库状态待对账"
				: "发布任务已提交",
		);
		await pollPublishTask(publishTask.id);
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "发布失败");
	} finally {
		saving = false;
	}
}

async function recoverDeploymentWait() {
	if (
		!publishTask ||
		!canRecoverDeploymentWait(publishTask.status) ||
		!window.confirm(
			"确定解除部署等待吗？仅在确认 workflow 回调不会再到达时使用。文章将标记为构建失败并恢复本地编辑。",
		)
	)
		return;
	recovering = true;
	publishPollSequence += 1;
	try {
		publishTask = await adminRequest<PublishTask>(
			`/publish-tasks/${encodeURIComponent(publishTask.id)}/recover`,
			{ method: "POST" },
		);
		if (draft) await loadDraft(draft.id);
		onnotice("已解除部署等待，文章可重新编辑和发布");
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "解除部署等待失败");
	} finally {
		recovering = false;
	}
}

async function reconcilePublishTask() {
	if (!publishTask || !canReconcilePublishTask(publishTask.status)) return;
	reconciling = true;
	try {
		await adminRequest<PublishTask>(
			`/publish-tasks/${encodeURIComponent(publishTask.id)}/reconcile`,
			{ method: "POST" },
		);
		if (draft) await loadDraft(draft.id);
		onnotice("发布证据已对账，任务恢复等待部署");
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "发布对账失败");
	} finally {
		reconciling = false;
	}
}

async function discardRevision() {
	if (
		!draft?.capabilities.discardable ||
		!window.confirm(
			"确定放弃当前修订并恢复到已部署版本吗？未发布的修改将被覆盖。",
		)
	)
		return;
	discarding = true;
	try {
		const restored = await adminRequest<DraftDetail>(
			`/drafts/${encodeURIComponent(draft.id)}/discard`,
			{
				method: "POST",
				body: JSON.stringify({ expectedVersion: draft.version }),
			},
		);
		applyDraft(restored);
		onupdated(restored);
		onnotice("已恢复到线上部署版本");
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "放弃修订失败");
	} finally {
		discarding = false;
	}
}

async function reloadDraft() {
	if (!draft) return;
	await confirmDestructiveEditorAction(
		isDirty,
		() => window.confirm("重新加载将覆盖当前未保存更改，确定继续吗？"),
		async () => {
			await loadDraft(draft?.id as string);
			if (draft) onupdated(draft);
		},
	);
}

$effect(() => {
	if (!draft || !isDirty || saving || !draft.capabilities.editable) return;
	const timer = setTimeout(() => void saveDraft(), 30000);
	return () => clearTimeout(timer);
});
</script>

<svelte:window onkeydown={handleEditorKeydown} />
<section class="admin-editor admin-panel">
	{#if loading}<div class="admin-state"><span class="admin-spinner"></span><p>正在加载文章详情…</p></div>{:else}
		<div class="admin-editor-head"><div><p class="admin-kicker">{isNew ? "NEW DRAFT" : "EDIT POST"}</p><h2>{isNew ? "新建文章" : (draft?.title || "编辑文章")}</h2><div class="admin-save-meta"><span class:admin-unsaved={isDirty}><span class="admin-status-dot"></span>{isDirty ? "有未保存更改" : "所有更改已保存"}</span><span>上次保存 {formatSavedAt(lastSavedAt)}</span>{#if draft?.publicationState === "published"}<span class:admin-unsaved={draft.syncStatus === "modified"}>{draft.syncStatus === "modified" ? "未发布修订" : "线上版本"}</span>{/if}</div></div><div class="admin-actions"><button class="admin-button admin-button-primary" disabled={saving || discarding || !title.trim() || (draft !== null && !draft.capabilities.editable)} onclick={saveDraft}>{saving ? "处理中…" : "保存"}</button>{#if !isNew}<button class="admin-button admin-button-ghost" disabled={saving || discarding || isDirty || !draft?.capabilities.publishable || publishBusy} onclick={publishDraft}>{publishBusy ? "发布中…" : "发布"}</button>{#if draft?.capabilities.discardable}<button class="admin-button admin-button-ghost" disabled={saving || discarding || isDirty} onclick={discardRevision}>{discarding ? "恢复中…" : "放弃修订"}</button>{/if}{/if}</div></div>
		{#if conflict}<div class="admin-inline-state admin-content-conflict" role="alert"><span>!</span><div><strong>版本冲突</strong><p>服务器上的文章版本已更新。请重新加载后合并更改。</p><button onclick={reloadDraft}>重新加载最新版本</button></div></div>{/if}
		{#if publishTask}<div class="admin-publish-status admin-publish-{publishTask.status}" role="status"><strong>发布状态：{publishTask.status}</strong><span>{publishTask.targetPath || "正在确定发布路径"}</span>{#if canRecoverDeploymentWait(publishTask.status)}<button class="admin-button admin-button-danger" disabled={recovering} onclick={recoverDeploymentWait}>{recovering ? "解除中…" : "解除等待"}</button>{/if}{#if canReconcilePublishTask(publishTask.status)}<button class="admin-button" disabled={reconciling} onclick={reconcilePublishTask}>{reconciling ? "对账中…" : "重新对账"}</button>{/if}</div>{/if}
		<div class="admin-section-heading"><div><p class="admin-kicker">METADATA</p><h3>文章信息</h3></div><span class="admin-hint">标题为必填项</span></div>
		<div class="admin-fields"><label class="admin-field-wide">标题<input bind:value={title} placeholder="文章标题" required /></label><label>Slug<input bind:value={slug} disabled={draft?.publicationState === "published"} placeholder="可选，例如 my-first-post" />{#if draft?.publicationState === "published"}<small>线上文章请使用下方重命名操作。</small>{/if}</label><label>语言<input bind:value={lang} placeholder="zh-CN" /></label><label>发布日期<input type="date" bind:value={published} required /></label><label>更新日期<input type="date" bind:value={updated} /></label><label class="admin-field-wide">描述<textarea bind:value={description} rows="3" placeholder="用于列表和分享卡片的文章摘要"></textarea></label><label class="admin-field-wide">AI 摘要<textarea bind:value={aiSummary} rows="3" placeholder="文章的 AI 摘要，可留空"></textarea></label><label class="admin-field-wide">封面图<div class="admin-cover-field"><input bind:value={image} placeholder="/media/cover.webp 或 https://…" /><button type="button" onclick={onmedia}>从媒体库选择</button></div></label><label>标签<input bind:value={tags} placeholder="多个标签用逗号分隔" /></label><label>分类<input bind:value={category} placeholder="文章分类" /></label><label>作者<input bind:value={author} placeholder="文章作者，可留空" /></label><label>来源链接<input type="url" bind:value={sourceLink} placeholder="https://…" /></label><label>许可名称<input bind:value={licenseName} placeholder="例如 CC BY-NC-SA 4.0" /></label><label>许可链接<input type="url" bind:value={licenseUrl} placeholder="https://…" /></label><div class="admin-field-wide admin-switches"><label class="admin-checkbox"><input type="checkbox" bind:checked={pinned} /><span>置顶文章<small>在文章列表中优先展示</small></span></label><label class="admin-checkbox"><input type="checkbox" bind:checked={comment} /><span>开启评论<small>允许读者在文章下留言</small></span></label></div></div>
		<div class="admin-section-heading"><div><p class="admin-kicker">CHECKS</p><h3>发布检查</h3></div><span class="admin-hint">实时更新 · 保存前过一遍</span></div>
		<ul class="admin-publish-checks">{#each publishChecks as check (check.text)}<li class={check.level}><i></i><span>{check.text}</span></li>{/each}</ul>
		<div class="admin-section-heading admin-writing-heading"><div><p class="admin-kicker">COMPOSE</p><h3>正文内容</h3></div><span class="admin-hint">Markdown · {content.length} 字符</span></div>
		<div class="admin-editor-tabs" role="tablist" aria-label="正文编辑模式"><button class:active={editorMode === "write"} class="admin-tab" role="tab" aria-selected={editorMode === "write"} onclick={() => editorMode = "write"}>编辑</button><button class:active={editorMode === "preview"} class="admin-tab" role="tab" aria-selected={editorMode === "preview"} onclick={() => editorMode = "preview"}>预览</button><button class="admin-media-shortcut" onclick={onmedia}>插入图片</button>{#if pasteUpload}<span class="admin-paste-status" role="status">上传中 {pasteUpload.progress}% · {pasteUpload.name}</span>{/if}</div>
		{#if editorMode === "write"}<label class="admin-content-label"><span class="sr-only">Markdown 原文</span><textarea class="admin-textarea" bind:value={content} bind:this={contentEl} onpaste={handleContentPaste} ondragover={handleContentDragOver} ondrop={handleContentDrop} placeholder="# 从这里开始写作…（支持直接粘贴或拖入截图，自动上传）" spellcheck="false"></textarea></label><p class="admin-shortcut-hint">Ctrl+S 保存 · 可直接粘贴/拖入图片自动上传 · 更改会自动留存本地快照，浏览器意外关闭后可恢复。</p>{:else}<article class="admin-preview admin-markdown-preview" aria-label="安全预览">{#if previewAvailable}{@html previewHtml}{:else}<p>预览会显示在这里。</p>{/if}</article>{/if}
		{#if draft}<PostHistoryPanel {draft} dirty={isDirty} onchanged={reloadDraft} {onerror} {onnotice} /><PostDangerActions {draft} dirty={isDirty} onchanged={reloadDraft} {ondeleted} {onerror} {onnotice} />{/if}
	{/if}
</section>
