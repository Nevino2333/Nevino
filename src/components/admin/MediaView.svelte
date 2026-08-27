<script lang="ts">
import { onMount } from "svelte";
import { adminApi, adminRequest } from "./admin-api";
import type { MediaAsset } from "./admin-types";

type Props = {
	onerror: (message: string) => void;
	onnotice: (message: string) => void;
	onstate: (state: { count: number; unavailable: boolean }) => void;
	oninsert: (markdown: string) => void;
	oncover: (url: string) => void;
};

let { onerror, onnotice, onstate, oninsert, oncover }: Props = $props();
let media = $state<MediaAsset[]>([]);
let loading = $state(true);
let unavailable = $state(false);
let uploading = $state(false);
let uploadProgress = $state(0);
let uploadStatus = $state("");
let dragActive = $state(false);
let input = $state<HTMLInputElement>();

function mediaUrl(asset: MediaAsset) {
	return (
		asset.public_url ||
		`/media/${asset.object_key.replace(/^\/+/, "").replace(/^media\//, "")}`
	);
}

function formatSize(value: number) {
	if (value < 1024) return `${value} B`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
	return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string) {
	const date = new Date(value);
	return Number.isNaN(date.getTime())
		? value
		: new Intl.DateTimeFormat("zh-CN", {
				year: "numeric",
				month: "short",
				day: "numeric",
			}).format(date);
}

async function loadMedia() {
	loading = true;
	try {
		const data = await adminRequest<{ media: MediaAsset[] }>("/media");
		media = data.media || [];
		unavailable = false;
		onstate({ count: media.length, unavailable: false });
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : "媒体加载失败";
		unavailable = message.includes("R2") || message.includes("暂不可用");
		onstate({ count: 0, unavailable });
		onerror(message);
	} finally {
		loading = false;
	}
}

async function uploadMedia(file: File) {
	if (!file || uploading) return;
	uploading = true;
	uploadProgress = 0;
	uploadStatus = "准备上传";
	try {
		const csrfToken = await adminApi.loadCsrf();
		const form = new FormData();
		form.append("file", file);
		await new Promise<void>((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			xhr.open("POST", "/api/admin/media");
			xhr.withCredentials = true;
			xhr.setRequestHeader("X-CSRF-Token", csrfToken);
			xhr.upload.onprogress = (event) => {
				if (event.lengthComputable)
					uploadProgress = Math.round((event.loaded / event.total) * 100);
				uploadStatus = `上传中 ${uploadProgress}%`;
			};
			xhr.onerror = () => reject(new Error("图片上传失败，请检查网络连接。"));
			xhr.onload = () => {
				if (xhr.status >= 200 && xhr.status < 300) resolve();
				else {
					const body = JSON.parse(xhr.responseText || "{}");
					reject(new Error(body.message || "图片上传失败"));
				}
			};
			xhr.send(form);
		});
		onnotice(`已上传 ${file.name}`);
		uploadProgress = 100;
		uploadStatus = "上传完成";
		await loadMedia();
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "图片上传失败");
		uploadStatus = "上传失败";
	} finally {
		uploading = false;
	}
}

function uploadFromInput(event: Event) {
	const element = event.currentTarget as HTMLInputElement;
	const file = element.files?.[0];
	if (file) uploadMedia(file);
	element.value = "";
}

function handleDrop(event: DragEvent) {
	event.preventDefault();
	dragActive = false;
	const file = event.dataTransfer?.files?.[0];
	if (file) uploadMedia(file);
}

async function copyMediaMarkdown(asset: MediaAsset) {
	try {
		await navigator.clipboard.writeText(
			`![${asset.filename}](${mediaUrl(asset)})`,
		);
		onnotice(`已复制 ${asset.filename} 的 Markdown`);
	} catch {
		onerror("复制失败，请检查浏览器剪贴板权限。");
	}
}

async function deleteMedia(asset: MediaAsset) {
	if (
		!window.confirm(
			`确定删除“${asset.filename}”吗？文章中已使用的图片可能会失效，此操作不可撤销。`,
		)
	)
		return;
	try {
		await adminRequest(`/media/${encodeURIComponent(asset.id)}`, {
			method: "DELETE",
		});
		onnotice(`已删除 ${asset.filename}`);
		await loadMedia();
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "媒体删除失败");
	}
}

function handlePaste(event: ClipboardEvent) {
	if (uploading) return;
	const file = Array.from(event.clipboardData?.files || []).find((item) =>
		item.type.startsWith("image/"),
	);
	if (file) {
		event.preventDefault();
		uploadMedia(file);
	}
}

onMount(() => {
	document.addEventListener("paste", handlePaste);
	loadMedia();
	return () => document.removeEventListener("paste", handlePaste);
});
</script>

<section class="admin-view"><div class="admin-view-heading"><div><p class="admin-kicker">MEDIA LIBRARY</p><h2>媒体库</h2><p>上传并管理文章中的图片资源。</p></div><label class:disabled={uploading || unavailable} class="admin-upload-button"><input bind:this={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={uploading || unavailable} onchange={uploadFromInput} />{uploading ? uploadStatus : "⇧ 选择图片"}</label></div>
	{#if unavailable}<div class="admin-inline-state admin-unavailable" role="alert"><span>◇</span><div><strong>媒体存储尚未启用</strong><p>媒体库暂不可用。当前环境未配置 R2 存储，不影响文章编辑与发布。</p></div></div>{/if}
	{#if loading}<div class="admin-panel admin-state admin-state-large"><span class="admin-spinner"></span><h3>正在加载媒体库</h3><p>正在读取 R2 中的图片资源…</p></div>{:else if !unavailable && media.length === 0}<div class:admin-drop-active={dragActive} class="admin-panel admin-state admin-state-large admin-drop-zone" role="button" tabindex="0" ondragover={(event) => { event.preventDefault(); dragActive = true; }} ondragleave={() => dragActive = false} ondrop={handleDrop} onclick={() => input?.click()} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") input?.click(); }}><span class="admin-state-icon">▧</span><h3>{uploading ? uploadStatus : "媒体库还是空的"}</h3><p>{uploading ? `正在上传，已完成 ${uploadProgress}%` : "拖拽图片到这里，或点击选择；也可以直接粘贴图片。"}</p>{#if uploading}<progress max="100" value={uploadProgress}></progress>{/if}</div>{:else if media.length > 0}<div class="admin-media-grid">{#each media as asset}<article class="admin-media-card admin-panel"><div class="admin-media-image"><img src={mediaUrl(asset)} alt={asset.filename} loading="lazy" /><span>{asset.mime_type.replace("image/", "").toUpperCase()}</span></div><div class="admin-media-info"><strong title={asset.filename}>{asset.filename}</strong><small>{formatSize(asset.size)} · {formatDate(asset.created_at)}</small><code>{mediaUrl(asset)}</code><div><button onclick={() => oninsert(`![${asset.filename}](${mediaUrl(asset)})`)}>插入正文</button><button onclick={() => oncover(mediaUrl(asset))}>设为封面</button><button onclick={() => copyMediaMarkdown(asset)}>复制 Markdown</button><button class="danger" onclick={() => deleteMedia(asset)}>删除</button></div></div></article>{/each}</div>{/if}
</section>
