<script lang="ts">
import { onMount } from "svelte";
import { adminApi, adminRequest } from "./admin-api";
import type { AuditPage, SessionItem } from "./admin-types";

type Props = {
	onnotice?: (message: string) => void;
	onerror?: (message: string) => void;
};

let { onnotice = () => {}, onerror = () => {} }: Props = $props();

let currentPassword = $state("");
let nextPassword = $state("");
let nextPasswordAgain = $state("");
let changing = $state(false);
let passwordErrors = $state<Record<string, string>>({});
let sessions = $state<SessionItem[]>([]);
let audit = $state<AuditPage>({ items: [], nextBefore: null });
let auditLoading = $state(false);
let loadingMore = $state(false);

async function loadSessions() {
	try {
		const result = await adminRequest<{ items: SessionItem[] }>("/sessions");
		sessions = result.items;
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "会话加载失败");
	}
}

async function loadAudit() {
	auditLoading = true;
	try {
		audit = await adminRequest<AuditPage>("/audit?limit=50");
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "审计日志加载失败");
	} finally {
		auditLoading = false;
	}
}

async function loadMore() {
	if (!audit.nextBefore) return;
	loadingMore = true;
	try {
		const more = await adminRequest<AuditPage>(
			"/audit?limit=50&before=" + encodeURIComponent(audit.nextBefore),
		);
		audit = {
			items: [...audit.items, ...more.items],
			nextBefore: more.nextBefore,
		};
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "审计日志加载失败");
	} finally {
		loadingMore = false;
	}
}

async function changePassword() {
	passwordErrors = {};
	if (nextPassword !== nextPasswordAgain) {
		passwordErrors = { next: "两次输入的新密钥不一致" };
		return;
	}
	changing = true;
	try {
		await adminRequest("/password", {
			method: "PUT",
			body: JSON.stringify({ current: currentPassword, next: nextPassword }),
		});
		currentPassword = "";
		nextPassword = "";
		nextPasswordAgain = "";
		await loadSessions();
		onnotice("密钥已更新，其他设备的会话已全部吊销");
	} catch (cause) {
		const error = cause as { fieldErrors?: Record<string, string> };
		passwordErrors = error.fieldErrors ?? {};
		onerror(cause instanceof Error ? cause.message : "更新失败");
	} finally {
		changing = false;
	}
}

async function revoke(session: SessionItem) {
	const label = session.current ? "当前会话" : "该会话";
	if (!confirm("吊销" + label + "？吊销后需要重新登录。")) return;
	try {
		await adminRequest(`/sessions/${session.id}`, { method: "DELETE" });
		if (session.current) {
			adminApi.clearCsrf();
			window.location.assign("/admin/login/");
			return;
		}
		await loadSessions();
		onnotice("会话已吊销");
	} catch (cause) {
		onerror(cause instanceof Error ? cause.message : "操作失败");
	}
}

const formatTime = (value: string): string =>
	value ? value.replace("T", " ").slice(0, 19) : "";

onMount(() => {
	void loadSessions();
	void loadAudit();
});
</script>

<section class="admin-view">
	<div class="admin-view-heading">
		<div>
			<p class="admin-kicker">SECURITY</p>
			<h2>安全审计</h2>
			<p>管理密钥、会话设备并审阅后台操作记录。</p>
		</div>
		<div class="admin-heading-actions">
			<button class="admin-button admin-button-ghost" onclick={() => { void loadSessions(); void loadAudit(); }}>刷新</button>
		</div>
	</div>

	<div class="admin-security-layout">
		<article class="admin-panel admin-password-panel">
			<h3>修改管理员密钥</h3>
			<p class="admin-muted">至少 12 个字符；更新后其他设备会话将被吊销。</p>
			<div class="admin-form-stack">
				<div class="admin-field">
					<label for="security-current">当前密钥</label>
					<input id="security-current" type="password" autocomplete="current-password" bind:value={currentPassword} />
					{#if passwordErrors.current}<p class="admin-field-error">{passwordErrors.current}</p>{/if}
				</div>
				<div class="admin-field">
					<label for="security-next">新密钥</label>
					<input id="security-next" type="password" autocomplete="new-password" bind:value={nextPassword} />
					{#if passwordErrors.next}<p class="admin-field-error">{passwordErrors.next}</p>{/if}
				</div>
				<div class="admin-field">
					<label for="security-again">确认新密钥</label>
					<input id="security-again" type="password" autocomplete="new-password" bind:value={nextPasswordAgain} />
				</div>
				<button class="admin-button admin-button-primary" disabled={changing || !currentPassword || !nextPassword} onclick={changePassword}>{changing ? "更新中…" : "更新密钥"}</button>
			</div>
		</article>

		<article class="admin-panel">
			<h3>活动会话</h3>
			<p class="admin-muted">会话通过 HttpOnly Cookie 维持，服务端仅保存哈希。</p>
			<ul class="admin-session-list">
				{#each sessions as session (session.id)}
					<li>
						<div>
							<strong>{session.current ? "当前设备" : "其他设备"}</strong>
							<small class="admin-muted">创建于 {formatTime(session.createdAt)} · 过期于 {new Date(session.expiresAt).toISOString().slice(0, 19).replace("T", " ")}</small>
						</div>
						<button class="admin-button admin-button-danger" onclick={() => revoke(session)}>吊销</button>
					</li>
				{/each}
			</ul>
		</article>
	</div>

	<article class="admin-panel admin-audit-panel">
		<h3>审计日志</h3>
		{#if auditLoading}
			<div class="admin-state"><span class="admin-spinner"></span><p>正在加载…</p></div>
		{:else}
			<div class="admin-table-wrap">
				<table class="admin-table">
					<thead><tr><th>时间</th><th>操作</th><th>结果</th><th>资源</th><th>IP</th></tr></thead>
					<tbody>
						{#each audit.items as item (item.id)}
							<tr>
								<td>{formatTime(item.createdAt)}</td>
								<td><code>{item.action}</code></td>
								<td><span class="admin-status-pill {item.result === 'failure' ? 'admin-status-failed' : 'admin-status-completed'}">{item.result || "—"}</span></td>
								<td><small>{item.resourceType}{item.resourceId ? " · " + item.resourceId : ""}</small></td>
								<td><small>{item.ip || "—"}</small></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if audit.nextBefore}
				<button class="admin-button admin-button-ghost admin-load-more" disabled={loadingMore} onclick={loadMore}>{loadingMore ? "加载中…" : "加载更早记录"}</button>
			{/if}
		{/if}
	</article>
</section>
