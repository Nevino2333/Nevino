<script lang="ts">
import { AdminApiError, adminRequest } from "./admin-api";
import type {
	DraftDetail,
	DraftSummary,
	DraftWrite,
	PublishTask,
} from "./admin-types";
import {
	canApplySaveResult,
	canPublishEditor,
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
const previewText = $derived(renderPlainText(content));

$effect(() => {
	ondirtychange(isDirty);
});
const isNew = $derived(resourceId === null);
const publishBusy = $derived(
	publishTask ? shouldPollPublishTask(publishTask.status) : false,
);

function renderPlainText(value: string) {
	return value
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "[图片：$1]")
		.replace(/\*\*(.+?)\*\*/g, "$1")
		.replace(/__(.+?)__/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}

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

$effect(() => {
	if (!mediaCover || mediaCover.key === appliedCoverKey) return;
	appliedCoverKey = mediaCover.key;
	image = mediaCover.value;
});

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

<section class="admin-editor admin-panel">
	{#if loading}<div class="admin-state"><span class="admin-spinner"></span><p>正在加载文章详情…</p></div>{:else}
		<div class="admin-editor-head"><div><p class="admin-kicker">{isNew ? "NEW DRAFT" : "EDIT POST"}</p><h2>{isNew ? "新建文章" : (draft?.title || "编辑文章")}</h2><div class="admin-save-meta"><span class:admin-unsaved={isDirty}><span class="admin-status-dot"></span>{isDirty ? "有未保存更改" : "所有更改已保存"}</span><span>上次保存 {formatSavedAt(lastSavedAt)}</span>{#if draft?.publicationState === "published"}<span class:admin-unsaved={draft.syncStatus === "modified"}>{draft.syncStatus === "modified" ? "未发布修订" : "线上版本"}</span>{/if}</div></div><div class="admin-actions"><button class="admin-button admin-button-primary" disabled={saving || discarding || !title.trim() || (draft !== null && !draft.capabilities.editable)} onclick={saveDraft}>{saving ? "处理中…" : "保存"}</button>{#if !isNew}<button class="admin-button admin-button-ghost" disabled={saving || discarding || isDirty || !draft?.capabilities.publishable || publishBusy} onclick={publishDraft}>{publishBusy ? "发布中…" : "发布"}</button>{#if draft?.capabilities.discardable}<button class="admin-button admin-button-ghost" disabled={saving || discarding || isDirty} onclick={discardRevision}>{discarding ? "恢复中…" : "放弃修订"}</button>{/if}{/if}</div></div>
		{#if conflict}<div class="admin-inline-state admin-content-conflict" role="alert"><span>!</span><div><strong>版本冲突</strong><p>服务器上的文章版本已更新。请重新加载后合并更改。</p><button onclick={reloadDraft}>重新加载最新版本</button></div></div>{/if}
		{#if publishTask}<div class="admin-publish-status admin-publish-{publishTask.status}" role="status"><strong>发布状态：{publishTask.status}</strong><span>{publishTask.targetPath || "正在确定发布路径"}</span>{#if canRecoverDeploymentWait(publishTask.status)}<button class="admin-button admin-button-danger" disabled={recovering} onclick={recoverDeploymentWait}>{recovering ? "解除中…" : "解除等待"}</button>{/if}</div>{/if}
		<div class="admin-section-heading"><div><p class="admin-kicker">METADATA</p><h3>文章信息</h3></div><span class="admin-hint">标题为必填项</span></div>
		<div class="admin-fields"><label class="admin-field-wide">标题<input bind:value={title} placeholder="文章标题" required /></label><label>Slug<input bind:value={slug} disabled={draft?.publicationState === "published"} placeholder="可选，例如 my-first-post" />{#if draft?.publicationState === "published"}<small>线上文章请使用下方重命名操作。</small>{/if}</label><label>语言<input bind:value={lang} placeholder="zh-CN" /></label><label>发布日期<input type="date" bind:value={published} required /></label><label>更新日期<input type="date" bind:value={updated} /></label><label class="admin-field-wide">描述<textarea bind:value={description} rows="3" placeholder="用于列表和分享卡片的文章摘要"></textarea></label><label class="admin-field-wide">AI 摘要<textarea bind:value={aiSummary} rows="3" placeholder="文章的 AI 摘要，可留空"></textarea></label><label class="admin-field-wide">封面图<div class="admin-cover-field"><input bind:value={image} placeholder="/media/cover.webp 或 https://…" /><button type="button" onclick={onmedia}>从媒体库选择</button></div></label><label>标签<input bind:value={tags} placeholder="多个标签用逗号分隔" /></label><label>分类<input bind:value={category} placeholder="文章分类" /></label><label>作者<input bind:value={author} placeholder="文章作者，可留空" /></label><label>来源链接<input type="url" bind:value={sourceLink} placeholder="https://…" /></label><label>许可名称<input bind:value={licenseName} placeholder="例如 CC BY-NC-SA 4.0" /></label><label>许可链接<input type="url" bind:value={licenseUrl} placeholder="https://…" /></label><div class="admin-field-wide admin-switches"><label class="admin-checkbox"><input type="checkbox" bind:checked={pinned} /><span>置顶文章<small>在文章列表中优先展示</small></span></label><label class="admin-checkbox"><input type="checkbox" bind:checked={comment} /><span>开启评论<small>允许读者在文章下留言</small></span></label></div></div>
		<div class="admin-section-heading admin-writing-heading"><div><p class="admin-kicker">COMPOSE</p><h3>正文内容</h3></div><span class="admin-hint">Markdown · {content.length} 字符</span></div>
		<div class="admin-editor-tabs" role="tablist" aria-label="正文编辑模式"><button class:active={editorMode === "write"} class="admin-tab" role="tab" aria-selected={editorMode === "write"} onclick={() => editorMode = "write"}>编辑</button><button class:active={editorMode === "preview"} class="admin-tab" role="tab" aria-selected={editorMode === "preview"} onclick={() => editorMode = "preview"}>纯文本预览</button><button class="admin-media-shortcut" onclick={onmedia}>插入图片</button></div>
		{#if editorMode === "write"}<label class="admin-content-label"><span class="sr-only">Markdown 原文</span><textarea class="admin-textarea" bind:value={content} placeholder="# 从这里开始写作…" spellcheck="false"></textarea></label><p class="admin-shortcut-hint">预览只显示纯文本，不执行 Markdown 中的 HTML 或脚本。</p>{:else}<article class="admin-preview" aria-label="纯文本安全预览">{previewText || "预览会显示在这里。"}</article>{/if}
		{#if draft}<PostHistoryPanel {draft} dirty={isDirty} onchanged={reloadDraft} {onerror} {onnotice} /><PostDangerActions {draft} dirty={isDirty} onchanged={reloadDraft} {ondeleted} {onerror} {onnotice} />{/if}
	{/if}
</section>
