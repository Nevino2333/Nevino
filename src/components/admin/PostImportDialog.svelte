<script lang="ts">
import { onMount } from "svelte";
import { adminRequest } from "./admin-api";
import type {
	DraftDetail,
	PostImportCandidate,
	PostImportCandidatePage,
} from "./admin-types";

type Props = {
	onclose: () => void;
	onimported: (draft: DraftDetail) => void;
	onerror: (message: string) => void;
};

let { onclose, onimported, onerror }: Props = $props();
let items = $state<PostImportCandidate[]>([]);
let page = $state(1);
let pageSize = $state(20);
let total = $state(0);
let loading = $state(true);
let importingPath = $state("");
let selected = $state<PostImportCandidate | null>(null);
let firstButton: HTMLButtonElement;
let pageCount = $derived(Math.max(1, Math.ceil(total / pageSize)));

async function load(nextPage = page) {
	loading = true;
	try {
		const data = await adminRequest<PostImportCandidatePage>(
			`/imports/posts?page=${nextPage}&pageSize=20`,
		);
		items = data.items;
		page = data.page;
		pageSize = data.pageSize;
		total = data.total;
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "导入候选加载失败");
	} finally {
		loading = false;
	}
}

async function importPost() {
	if (selected?.classification !== "importable") return;
	importingPath = selected.path;
	try {
		const draft = await adminRequest<DraftDetail>("/imports/posts", {
			method: "POST",
			body: JSON.stringify({
				path: selected.path,
				expectedSha: selected.expectedSha,
				idempotencyKey: crypto.randomUUID(),
			}),
		});
		onimported(draft);
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "文章导入失败");
	} finally {
		importingPath = "";
	}
}

function closeOnBackdrop(event: MouseEvent) {
	if (event.target === event.currentTarget && !importingPath) onclose();
}

function closeOnEscape(event: KeyboardEvent) {
	if (event.key === "Escape" && !importingPath) onclose();
}

onMount(() => {
	firstButton?.focus();
	void load();
});
</script>

<svelte:window onkeydown={closeOnEscape} />
<div class="admin-dialog-backdrop" role="presentation" onclick={closeOnBackdrop}>
	<section class="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-import-title">
		<div class="admin-dialog-head"><div><p class="admin-kicker">IMPORT</p><h2 id="admin-import-title">导入 GitHub 文章</h2></div><button bind:this={firstButton} class="admin-dialog-close" aria-label="关闭导入对话框" disabled={Boolean(importingPath)} onclick={onclose}>×</button></div>
		<p class="admin-muted">选择仓库中尚未绑定后台工作副本的 Markdown 文章。</p>
		{#if loading}<div class="admin-state admin-state-small"><span class="admin-spinner"></span><p>正在读取候选…</p></div>{:else if items.length === 0}<div class="admin-state admin-state-small"><h3>没有可显示的仓库文章</h3></div>{:else}<div class="admin-import-list" role="listbox" aria-label="可导入文章">{#each items as item}<button class:active={selected?.id === item.id} disabled={item.classification !== "importable" || Boolean(importingPath)} onclick={() => selected = item}><span><strong>{item.slug || "无效 slug"}</strong><small>{item.path}</small></span><em>{item.classification === "importable" ? "可导入" : item.classification === "bound" ? "已导入" : item.classification === "unsupported" ? "不支持 MDX" : "路径无效"}</em></button>{/each}</div>{/if}
		<div class="admin-dialog-foot"><div class="admin-list-pagination"><button disabled={page <= 1 || loading || Boolean(importingPath)} onclick={() => load(page - 1)}>上一页</button><span>{page} / {pageCount}</span><button disabled={page >= pageCount || loading || Boolean(importingPath)} onclick={() => load(page + 1)}>下一页</button></div><div class="admin-actions"><button class="admin-button admin-button-ghost" disabled={Boolean(importingPath)} onclick={onclose}>取消</button><button class="admin-button admin-button-primary" disabled={!selected || Boolean(importingPath)} onclick={importPost}>{importingPath ? "导入中…" : "确认导入"}</button></div></div>
	</section>
</div>
