<script lang="ts">
import { adminRequest } from "./admin-api";
import {
	canConfirmTitle,
	isOperationPendingReconciliation,
	operationRequest,
} from "./admin-operations";
import type { ContentOperation, DraftDetail } from "./admin-types";

type Props = {
	draft: DraftDetail;
	dirty: boolean;
	onchanged: () => Promise<void> | void;
	ondeleted: () => void;
	onerror: (message: string) => void;
	onnotice: (message: string) => void;
};

let { draft, dirty, onchanged, ondeleted, onerror, onnotice }: Props = $props();
let action = $state<"rename" | "withdraw" | "delete" | null>(null);
let busy = $state(false);
let reconciling = $state(false);
let newSlug = $state("");
let confirmation = $state("");
let operation = $state<ContentOperation | null>(null);

function reset() {
	action = null;
	newSlug = "";
	confirmation = "";
	operation = null;
}

async function submitRename() {
	if (!draft.githubSha || !newSlug.trim()) return;
	if (
		!window.confirm(`确定重命名文章路径吗？\n${draft.slug} → ${newSlug.trim()}`)
	)
		return;
	await submit(
		"rename",
		`/drafts/${encodeURIComponent(draft.id)}/rename`,
		operationRequest(draft.version, crypto.randomUUID(), {
			newSlug: newSlug.trim(),
			expectedBlobSha: draft.githubSha,
		}),
	);
}

async function submitWithdraw() {
	if (!canConfirmTitle(draft.title, confirmation)) return;
	if (!window.confirm(`确定撤回“${draft.title}”的线上版本吗？`)) return;
	await submit(
		"withdraw",
		`/drafts/${encodeURIComponent(draft.id)}/withdraw`,
		operationRequest(draft.version, crypto.randomUUID(), {}),
	);
}

async function submitDelete() {
	if (!canConfirmTitle(draft.title, confirmation)) return;
	if (!window.confirm(`确定永久删除“${draft.title}”吗？此操作不可撤销。`))
		return;
	busy = true;
	try {
		await adminRequest<{ deleted: true }>(
			`/drafts/${encodeURIComponent(draft.id)}`,
			{
				method: "DELETE",
				body: JSON.stringify({ expectedVersion: draft.version }),
			},
		);
		onnotice(draft.publicationState === "draft" ? "草稿已删除" : "文章已删除");
		ondeleted();
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "删除失败");
	} finally {
		busy = false;
	}
}

async function submit(type: "rename" | "withdraw", path: string, body: object) {
	busy = true;
	try {
		operation = await adminRequest<ContentOperation>(path, {
			method: "POST",
			body: JSON.stringify(body),
		});
		if (isOperationPendingReconciliation(operation)) {
			onnotice("GitHub 已提交，数据库状态待对账");
			return;
		}
		onnotice(
			type === "rename"
				? "重命名已提交，等待部署完成"
				: "撤回已提交，等待部署完成",
		);
		await onchanged();
		reset();
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "危险操作失败");
	} finally {
		busy = false;
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
		reset();
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "操作对账失败");
	} finally {
		reconciling = false;
	}
}
</script>

{#if draft.capabilities.renameable || draft.capabilities.withdrawable || draft.capabilities.deletable}<section class="admin-danger-zone"><div><p class="admin-kicker">DANGER ZONE</p><h3>危险操作</h3><p>这些操作会改变线上路径、可见性或数据，请先保存编辑内容。</p></div><div class="admin-danger-actions">{#if draft.capabilities.renameable}<button class="admin-button admin-button-danger" disabled={dirty || busy} onclick={() => action = action === "rename" ? null : "rename"}>重命名</button>{/if}{#if draft.capabilities.withdrawable}<button class="admin-button admin-button-danger" disabled={dirty || busy} onclick={() => action = action === "withdraw" ? null : "withdraw"}>撤回线上文章</button>{/if}{#if draft.capabilities.deletable}<button class="admin-button admin-button-danger" disabled={dirty || busy} onclick={() => action = action === "delete" ? null : "delete"}>删除文章</button>{/if}</div>{#if action === "rename"}<div class="admin-danger-confirm"><p>当前路径：<strong>{draft.slug}</strong></p><label>新 slug<input bind:value={newSlug} autocomplete="off" /></label><p>{draft.slug} → {newSlug.trim() || "新路径"}</p><button class="admin-button admin-button-danger" disabled={!newSlug.trim() || busy} onclick={submitRename}>{busy ? "处理中…" : "二次确认重命名"}</button></div>{:else if action === "withdraw"}<div class="admin-danger-confirm"><label>输入完整标题“{draft.title}”<input bind:value={confirmation} autocomplete="off" /></label><button class="admin-button admin-button-danger" disabled={!canConfirmTitle(draft.title, confirmation) || busy} onclick={submitWithdraw}>{busy ? "处理中…" : "二次确认撤回"}</button></div>{:else if action === "delete"}<div class="admin-danger-confirm"><label>输入完整标题“{draft.title}”<input bind:value={confirmation} autocomplete="off" /></label>{#if draft.publicationState !== "draft"}<small class="admin-muted">文章已下线，删除仅移除后台记录，GitHub 历史仍会保留。</small>{/if}<button class="admin-button admin-button-danger" disabled={!canConfirmTitle(draft.title, confirmation) || busy} onclick={submitDelete}>{busy ? "处理中…" : "二次确认删除"}</button></div>{/if}{#if isOperationPendingReconciliation(operation)}<div class="admin-inline-state admin-unavailable" role="status"><span>!</span><div><strong>操作等待对账</strong><p>远端提交已完成，但本地状态需要验证证据后恢复。</p><button disabled={reconciling} onclick={reconcile}>{reconciling ? "对账中…" : "重新对账"}</button></div></div>{/if}</section>{/if}
