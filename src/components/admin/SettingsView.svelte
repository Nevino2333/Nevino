<script lang="ts">
import StructuredConfigEditor from "./StructuredConfigEditor.svelte";

type Props = {
	onnotice?: (message: string) => void;
	onerror?: (message: string) => void;
};

let { onnotice = () => {}, onerror = () => {} }: Props = $props();

type SettingsGroup = {
	key: string;
	label: string;
	hint: string;
	section: "基础" | "内容与外观" | "集成与体验";
};

const groups: SettingsGroup[] = [
	{
		key: "site",
		label: "站点信息",
		hint: "标题、描述、页面开关与布局",
		section: "基础",
	},
	{
		key: "profile",
		label: "个人资料",
		hint: "头像、签名与社交链接",
		section: "基础",
	},
	{
		key: "footer",
		label: "页脚",
		hint: "页脚注入与自定义 HTML",
		section: "基础",
	},
	{
		key: "license",
		label: "版权许可",
		hint: "文章许可证信息",
		section: "基础",
	},
	{
		key: "music",
		label: "音乐",
		hint: "播放器、歌单与歌词",
		section: "内容与外观",
	},
	{
		key: "wallpaper",
		label: "壁纸与横幅",
		hint: "壁纸模式、横幅与轮播",
		section: "内容与外观",
	},
	{
		key: "covers",
		label: "文章封面",
		hint: "封面展示与随机图 API",
		section: "内容与外观",
	},
	{
		key: "effects",
		label: "樱花特效",
		hint: "数量、速度与动画参数",
		section: "内容与外观",
	},
	{
		key: "intro",
		label: "首页开屏",
		hint: "默认角色与开屏横幅",
		section: "内容与外观",
	},
	{
		key: "comment",
		label: "评论系统",
		hint: "Giscus/Waline 等服务参数",
		section: "集成与体验",
	},
	{
		key: "analytics",
		label: "访问统计",
		hint: "统计服务 ID 与展示开关",
		section: "集成与体验",
	},
	{
		key: "expressiveCode",
		label: "代码高亮",
		hint: "代码主题与折叠插件",
		section: "集成与体验",
	},
	{
		key: "plantuml",
		label: "PlantUML",
		hint: "图表服务器与主题",
		section: "集成与体验",
	},
	{
		key: "font",
		label: "字体",
		hint: "全局与分区字体选择",
		section: "集成与体验",
	},
	{
		key: "pio",
		label: "看板娘",
		hint: "Spine/Live2D 与互动文案",
		section: "集成与体验",
	},
];

let active = $state<string>(groups[0].key);
let editor: { canLeaveEditor(): boolean } | null = null;
const activeGroup = $derived(groups.find((group) => group.key === active));
const sections = $derived(
	["基础", "内容与外观", "集成与体验"].map((section) => ({
		section,
		items: groups.filter((group) => group.section === section),
	})),
);

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

	<div class="admin-settings-sections">
		{#each sections as groupSection (groupSection.section)}
			<div class="admin-settings-section">
				<p class="admin-nav-heading">{groupSection.section}</p>
				<div class="admin-page-tabs admin-settings-tabs">
					{#each groupSection.items as group (group.key)}
						<button class:active={active === group.key} onclick={() => switchGroup(group.key)}>
							<strong>{group.label}</strong>
							<small>{group.hint}</small>
						</button>
					{/each}
				</div>
			</div>
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
