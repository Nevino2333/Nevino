<script lang="ts">
type Props = {
	submitting: boolean;
	error: string;
	onsubmit: (credentials: { username: string; password: string }) => void;
};

let { submitting, error, onsubmit }: Props = $props();
let username = $state("");
let password = $state("");
let showPassword = $state(false);

function submit(event: SubmitEvent) {
	event.preventDefault();
	if (!submitting) onsubmit({ username, password });
}
</script>

<main class="admin-shell admin-login-shell">
	<div class="admin-login-backdrop" aria-hidden="true"><span></span><span></span><span></span></div>
	<section class="admin-login admin-panel">
		<a class="admin-login-back" href="/" aria-label="返回 Nevino's blog"><span aria-hidden="true">←</span> 返回博客</a>
		<div class="admin-login-brand"><div class="admin-login-avatar"><img src="/assets/Avater.png" alt="" /></div><div><span class="admin-login-brand-name">Nevino's blog</span><span class="admin-login-brand-subtitle">PERSONAL WRITING SPACE</span></div></div>
		<div class="admin-login-heading"><p class="admin-kicker">PRIVATE ACCESS / 01</p><h1>欢迎回来</h1><p class="admin-muted">登录后管理文章与媒体，继续写下下一段想法。</p></div>
		<form class="admin-login-form" onsubmit={submit}>
			<label for="username">用户名<input id="username" bind:value={username} autocomplete="username" placeholder="输入管理员用户名" required /></label>
			<label for="password">密码<div class="admin-password-field"><input id="password" type={showPassword ? "text" : "password"} bind:value={password} autocomplete="current-password" placeholder="输入管理员密码" required /><button type="button" class="admin-password-toggle" aria-label={showPassword ? "隐藏密码" : "显示密码"} onclick={() => showPassword = !showPassword}>{showPassword ? "隐藏" : "显示"}</button></div></label>
			<button class="admin-button admin-button-primary admin-login-submit" type="submit" disabled={submitting}>{#if submitting}<span class="admin-button-spinner" aria-hidden="true"></span>正在验证…{:else}进入写作后台<span aria-hidden="true">→</span>{/if}</button>
		</form>
		{#if error}<div class="admin-login-error" role="alert"><span aria-hidden="true">!</span><span>{error}</span></div>{/if}
		<div class="admin-login-security"><span class="admin-security-icon" aria-hidden="true">⌁</span><div><strong>安全连接</strong><span>密码仅用于本次验证，不会保存到浏览器。</span></div></div>
	</section>
	<p class="admin-login-footer">Nevino's blog <span>·</span> WRITE SOMETHING TRUE</p>
</main>
