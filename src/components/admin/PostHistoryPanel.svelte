<script lang="ts">
import { adminRequest } from "./admin-api";
import {
	isOperationPendingReconciliation,
	rollbackRequestForDraft,
} from "./admin-operations";
import type {
	ContentHistoryItem,
	ContentHistoryPage,
	ContentOperation,
	DraftDetail,
	HistoryDetail,
} from "./admin-types";

type Props = {
	draft: DraftDetail;
	dirty: boolean;
	onchanged: () => Promise<void> | void;
	onerror: (message: string) => void;
	onnotice: (message: string) => void;
};

let { draft, dirty, onchanged, onerror, onnotice }: Props = $props();
let open = $state(false);
let loading = $state(false);
let detailLoading = $state(false);
let rollingBack = $state(false);
let reconciling = $state(false);
let history = $state<ContentHistoryItem[]>([]);
let detail = $state<HistoryDetail | null>(null);
let selectedId = $state("");
let password = $state("");
let operation = $state<ContentOperation | null>(null);

async function loadHistory() {
	open = true;
	loading = true;
	try {
		const data = await adminRequest<ContentHistoryPage>(
			`/drafts/${encodeURIComponent(draft.id)}/history?page=1&pageSize=50`,
		);
		history = data.items;
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "历史加载失败");
	} finally {
		loading = false;
	}
}

async function selectRecord(item: ContentHistoryItem) {
	selectedId = item.id;
	detailLoading = true;
	detail = null;
	try {
		detail = await adminRequest<HistoryDetail>(
			`/drafts/${encodeURIComponent(draft.id)}/history/${encodeURIComponent(item.id)}`,
		);
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "历史详情加载失败");
	} finally {
		detailLoading = false;
	}
}

async function rollback() {
	if (!detail?.editable || !draft.capabilities.renameable || !password) return;
	if (dirty && !window.confirm("回滚将覆盖当前未保存更改，确定继续吗？"))
		return;
	if (
		!window.confirm(
			`确定将“${draft.title}”回滚到提交 ${detail.record.commitSha.slice(0, 7)} 吗？`,
		)
	)
		return;
	rollingBack = true;
	try {
		operation = await adminRequest<ContentOperation>(
			`/drafts/${encodeURIComponent(draft.id)}/rollback`,
			{
				method: "POST",
				body: JSON.stringify(
					rollbackRequestForDraft(
						draft,
						crypto.randomUUID(),
						detail.record.commitSha,
						password,
					),
				),
			},
		);
		password = "";
		if (isOperationPendingReconciliation(operation)) {
			onnotice("GitHub 已提交，数据库状态待对账");
			return;
		}
		onnotice("回滚已提交，等待部署完成");
		await onchanged();
		await loadHistory();
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "回滚失败");
	} finally {
		rollingBack = false;
	}
}

async function reconcile() {
	if (!operation) return;
	reconciling = true;
	try {
		operation = await adminRequest<ContentOperation>(
			`/content-operations/${encodeURIComponent(operation.id)}/reconcile`,
			{ method: "POST", body: "{}" },
		);
		onnotice("操作证据已对账，等待部署完成");
		await onchanged();
		await loadHistory();
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "操作对账失败");
	} finally {
		reconciling = false;
	}
}

function formatDate(value: string) {
	return new Intl.DateTimeFormat("zh-CN", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}
</script>

<section class="admin-history-section">
	<div class="admin-section-heading"><div><p class="admin-kicker">HISTORY</p><h3>文章历史</h3></div><button class="admin-button admin-button-ghost" onclick={() => open ? open = false : loadHistory()}>{open ? "收起历史" : "查看历史"}</button></div>
	{#if open}<div class="admin-history-panel">{#if loading}<div class="admin-state admin-state-small"><span class="admin-spinner"></span><p>正在加载历史…</p></div>{:else}<div class="admin-history-list">{#each history as item}<button class:active={selectedId === item.id} onclick={() => selectRecord(item)}><strong>{item.message || item.operationType || item.revisionSource || "内容变更"}</strong><span>{formatDate(item.createdAt)}{item.authorName ? ` · ${item.authorName}` : ""}</span><small>{item.commitSha?.slice(0, 7) || `v${item.version ?? "-"}`} · {item.sources.join(" + ")}</small></button>{/each}</div><div class="admin-history-detail">{#if detailLoading}<div class="admin-state admin-state-small"><span class="admin-spinner"></span></div>{:else if detail}<div class="admin-history-meta"><strong>{detail.record.path}</strong><code>{detail.record.commitSha}</code>{#if !detail.editable}<p role="status">该版本含后台不支持字段，只能查看。</p>{/if}</div><div class="admin-diff" aria-label="历史差异">{#each detail.diff as line}<div class="admin-diff-line admin-diff-{line.type}"><span>{line.oldLine ?? ""}</span><span>{line.newLine ?? ""}</span><code>{line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}{line.text}</code></div>{/each}</div>{#if detail.editable && draft.capabilities.renameable}<div class="admin-history-rollback"><label>管理员密码<input type="password" bind:value={password} autocomplete="current-password" /></label><button class="admin-button admin-button-danger" disabled={!password || rollingBack} onclick={rollback}>{rollingBack ? "回滚中…" : "回滚到此版本"}</button></div>{/if}{#if isOperationPendingReconciliation(operation)}<button class="admin-button admin-button-danger" disabled={reconciling} onclick={reconcile}>{reconciling ? "对账中…" : "重新对账"}</button>{/if}{:else}<div class="admin-state admin-state-small"><p>选择一条记录查看安全文本差异。</p></div>{/if}</div>{/if}</div>{/if}
</section>
