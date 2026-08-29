<script lang="ts">
import { adminRequest } from "./admin-api";
import type {
	SpecPageDetail,
	SpecPageHistoryDetail,
	SpecPageHistoryItem,
} from "./admin-types";

type Props = {
	initialPageKey?: string | null;
	onnotice?: (message: string) => void;
	onerror?: (message: string) => void;
	ondirtychange?: (dirty: boolean) => void;
};

let {
	initialPageKey = null,
	onnotice = () => {},
	onerror = () => {},
	ondirtychange = () => {},
}: Props = $props();

type PageSummary = {
	key: string;
	label: string;
	description: string;
	staged: boolean;
	deployedAt: string | null;
};

let pages = $state<PageSummary[]>([]);
let selectedKey = $state<string>(initialPageKey || "about");
let detail = $state<SpecPageDetail | null>(null);
let content = $state("");
let loading = $state(true);
let loadError = $state("");
let saving = $state(false);
let publishing = $state(false);
let dirty = $state(false);
let history = $state<SpecPageHistoryItem[] | null>(null);
let historyOpen = $state(false);
let historyDetail = $state<SpecPageHistoryDetail | null>(null);

export function canLeaveEditor(): boolean {
	return !dirty || window.confirm("页面有未保存修改，确定离开吗？");
}

$effect(() => {
	ondirtychange(dirty);
});

function onWindowKeydown(event: KeyboardEvent) {
	if (event.key === "Escape" && historyDetail) historyDetail = null;
}

function onBeforeUnload(event: BeforeUnloadEvent) {
	if (!dirty) return;
	event.preventDefault();
	event.returnValue = "";
}

async function loadPages() {
	pages = await adminRequest<PageSummary[]>("/pages");
}

async function loadDetail(key: string) {
	loading = true;
	loadError = "";
	try {
		detail = await adminRequest<SpecPageDetail>(`/pages/${key}`);
		content = detail.content;
		dirty = false;
		history = null;
		historyOpen = false;
		historyDetail = null;
	} catch (cause) {
		detail = null;
		loadError = cause instanceof Error ? cause.message : "页面加载失败";
		onerror(loadError);
	} finally {
		loading = false;
	}
}

async function select(key: string) {
	if (dirty && !window.confirm("页面有未保存修改，确定切换吗？")) return;
	selectedKey = key;
	await loadDetail(key);
}

async function save() {
	if (!detail) return;
	saving = true;
	try {
		detail = await adminRequest<SpecPageDetail>(`/pages/${selectedKey}`, {
			method: "PUT",
			body: JSON.stringify({ content, expectedVersion: detail.version }),
		});
		content = detail.content;
		dirty = false;
		await loadPages();
		onnotice("修改已暂存，可发布到站点");
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "保存失败");
	} finally {
		saving = false;
	}
}

async function discard() {
	if (!confirm("放弃当前页面的未发布修改？")) return;
	try {
		await adminRequest(`/pages/${selectedKey}`, { method: "DELETE" });
		await loadDetail(selectedKey);
		await loadPages();
		onnotice("已放弃未发布修改");
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "操作失败");
	}
}

async function publish() {
	if (!confirm("发布该页面到 GitHub 并触发站点重建？")) return;
	publishing = true;
	try {
		detail = await adminRequest<SpecPageDetail>(
			`/pages/${selectedKey}/publish`,
			{
				method: "POST",
			},
		);
		content = detail.content;
		dirty = false;
		history = null;
		await loadPages();
		onnotice(
			detail.deployedCommitSha
				? "已提交（" + detail.deployedCommitSha.slice(0, 7) + "），等待站点重建"
				: "已提交，等待站点重建",
		);
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "发布失败");
	} finally {
		publishing = false;
	}
}

async function toggleHistory() {
	historyOpen = !historyOpen;
	if (historyOpen && !history) {
		try {
			const result = await adminRequest<{ items: SpecPageHistoryItem[] }>(
				`/pages/${selectedKey}/history`,
			);
			history = result.items;
		} catch (cause) {
			onerror(cause instanceof Error ? cause.message : "历史加载失败");
		}
	}
}

async function openRecord(record: string) {
	try {
		historyDetail = await adminRequest<SpecPageHistoryDetail>(
			`/pages/${selectedKey}/history/${record}`,
		);
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "历史详情加载失败");
	}
}

async function restoreRecord(record: string) {
	if (!confirm("将此版本暂存为当前修改？")) return;
	try {
		detail = await adminRequest<SpecPageDetail>(
			`/pages/${selectedKey}/restore`,
			{
				method: "POST",
				body: JSON.stringify({ record }),
			},
		);
		content = detail.content;
		dirty = false;
		historyDetail = null;
		history = null;
		await loadPages();
		onnotice("历史版本已暂存，检查后发布");
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "恢复失败");
	}
}

const recordLabel = (item: SpecPageHistoryItem): string =>
	item.type === "commit"
		? item.message || item.id.slice(0, 7)
		: "本地保存 · " + item.source;

// 初始加载
void (async () => {
	try {
		await loadPages();
		if (!pages.some((page) => page.key === selectedKey))
			selectedKey = pages[0]?.key ?? "about";
		await loadDetail(selectedKey);
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "页面加载失败");
	}
})();
</script>

<svelte:window onkeydown={onWindowKeydown} onbeforeunload={onBeforeUnload} />

<section class="admin-view">
	<div class="admin-view-heading">
		<div>
			<p class="admin-kicker">PAGES</p>
			<h2>页面</h2>
			<p>关于、留言板与友链页自定义内容，直接编辑 Markdown 并发布。</p>
		</div>
		<div class="admin-heading-actions">
			{#if detail?.staged}
				<button class="admin-button admin-button-ghost" onclick={discard}>放弃修改</button>
			{/if}
			<button class="admin-button admin-button-primary" disabled={saving || publishing || !dirty} onclick={save}>{saving ? "保存中…" : "保存暂存"}</button>
			<button class="admin-button" disabled={!detail?.staged || publishing} onclick={publish}>{publishing ? "发布中…" : "发布"}</button>
		</div>
	</div>

	<div class="admin-page-tabs">
		{#each pages as page (page.key)}
			<button class:active={page.key === selectedKey} onclick={() => select(page.key)}>
				{page.label}{#if page.staged}<span class="admin-dot-badge">改</span>{/if}
			</button>
		{/each}
	</div>

	{#if loading}
		<div class="admin-panel admin-state"><span class="admin-spinner"></span><p>正在加载页面…</p></div>
	{:else if loadError || !detail}
		<div class="admin-panel admin-state admin-state-large admin-error-state">
			<span class="admin-state-icon">!</span>
			<h3>页面加载失败</h3>
			<p>{loadError || "页面不可用"}</p>
			<p class="admin-muted">发布类操作依赖 GitHub 集成；若持续失败，请检查 Cloudflare 环境变量中的 GITHUB_TOKEN 等配置。</p>
			<button class="admin-button admin-button-primary" onclick={() => loadDetail(selectedKey)}>重试</button>
		</div>
	{:else if detail}
		{#if detail.stale}
			<div class="admin-alert admin-notice"><span>!</span>远端页面已被更新，当前暂存基于旧版本；重新保存后再发布。</div>
		{/if}
		<p class="admin-muted admin-file-path">{detail.filePath}</p>
		<textarea
			class="admin-markdown-area"
			rows="20"
			spellcheck="false"
			value={content}
			oninput={(event) => { content = event.currentTarget.value; dirty = true; }}
		></textarea>
		<p class="admin-muted">{dirty ? "有未保存修改" : detail.staged ? "存在未发布暂存" : "与线上版本一致"}</p>

		<div class="admin-panel admin-history-card">
			<header class="admin-history-header">
				<h3>历史版本</h3>
				<button class="admin-button admin-button-ghost" onclick={toggleHistory}>{historyOpen ? "收起" : "展开"}</button>
			</header>
			{#if historyOpen && history}
				<ul>
					{#each history as item (item.id)}
						<li>
							<button class="admin-link-button" onclick={() => openRecord(item.id)}>{recordLabel(item)}</button>
							<span class="admin-muted">{item.date}</span>
							<button class="admin-button admin-button-ghost" onclick={() => restoreRecord(item.id)}>暂存此版本</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}

	{#if historyDetail}
		<div class="admin-dialog-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) historyDetail = null; }}>
			<div class="admin-dialog" role="dialog" aria-label="历史版本差异">
				<header class="admin-dialog-head"><h2>{historyDetail.message ?? "本地保存"}</h2><button class="admin-dialog-close" aria-label="关闭" onclick={() => historyDetail = null}>×</button></header>
				<div class="admin-dialog-body">
					<div class="admin-diff">
						{#each historyDetail.diff as line, index (index)}
							<div class="admin-diff-line admin-diff-{line.type}">
								<span>{line.oldLine ?? ""}</span><span>{line.newLine ?? ""}</span><code>{line.text}</code>
							</div>
						{/each}
					</div>
				</div>
				<footer class="admin-dialog-foot">
					<button class="admin-button admin-button-ghost" onclick={() => historyDetail = null}>关闭</button>
					<button class="admin-button admin-button-primary" onclick={() => restoreRecord(historyDetail?.id ?? "")}>暂存此版本</button>
				</footer>
			</div>
		</div>
	{/if}
</section>
