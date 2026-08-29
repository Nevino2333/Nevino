<script lang="ts">
import StructuredConfigEditor from "./StructuredConfigEditor.svelte";

type Props = {
	onnotice?: (message: string) => void;
	onerror?: (message: string) => void;
};

let { onnotice = () => {}, onerror = () => {} }: Props = $props();

const groups: { key: string; label: string; hint: string }[] = [
	{ key: "site", label: "站点信息", hint: "标题、描述、页面开关与布局" },
	{ key: "profile", label: "个人资料", hint: "头像、签名与社交链接" },
	{ key: "comment", label: "评论系统", hint: "评论服务选择与参数" },
	{ key: "analytics", label: "访问统计", hint: "统计服务 ID 与展示开关" },
	{ key: "license", label: "版权许可", hint: "文章许可证信息" },
	{ key: "footer", label: "页脚", hint: "页脚注入与自定义 HTML" },
];

let active = $state<string>(groups[0].key);
let editor: { canLeaveEditor(): boolean } | null = null;
const activeGroup = $derived(groups.find((group) => group.key === active));

function switchGroup(key: string) {
	if (key === active) return;
	if (editor && !editor.canLeaveEditor()) return;
	active = key;
}
</script>

<section class="admin-view">
	<div class="admin-view-heading">
		<div>
			<p class="admin-kicker">SETTINGS</p>
			<h2>站点设置</h2>
			<p>修改先暂存为变更集，可预览差异后一次发布到 GitHub 并触发重建。</p>
		</div>
	</div>

	<div class="admin-page-tabs admin-settings-tabs">
		{#each groups as group (group.key)}
			<button class:active={active === group.key} onclick={() => switchGroup(group.key)}>
				<strong>{group.label}</strong>
				<small>{group.hint}</small>
			</button>
		{/each}
	</div>

	<StructuredConfigEditor
		bind:this={editor}
		groupKey={active}
		heading={activeGroup?.label}
		{onnotice}
		{onerror}
	/>
</section>
