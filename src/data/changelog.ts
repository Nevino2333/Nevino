export type ChangelogItem = {
	icon: string;
	text: string;
};

export type ChangelogEntry = {
	/** 展示日期，YYYY-MM-DD */
	date: string;
	title: string;
	brief: string;
	tags: string[];
	items: ChangelogItem[];
};

// 新条目放最前面；icon 用 material-symbols 图标名
export const changelogEntries: ChangelogEntry[] = [
	{
		date: "2026-10-06",
		title: "朗读、离线与速度",
		brief: "文章可以听了，博客可以离线了，页面也轻了一大圈。",
		tags: ["功能", "性能"],
		items: [
			{
				icon: "material-symbols:volume-up-rounded",
				text: "文章朗读接入 Edge TTS 神经音色，免费无需密钥，长文分段播放、自动续读",
			},
			{
				icon: "material-symbols:offline-bolt-rounded",
				text: "全站 PWA 离线缓存：二次访问更快，断网也能翻看已读页面",
			},
			{
				icon: "material-symbols:speed-rounded",
				text: "首页脚本 -83%，文章页样式 -37%，壁纸压缩 -72%（47.3MB → 13.2MB）",
			},
		],
	},
	{
		date: "2026-10-06",
		title: "内容与数据",
		brief: "追番页上线，分享卡片有了图，博客每天自动醒来一次。",
		tags: ["功能", "SEO"],
		items: [
			{
				icon: "material-symbols:live-tv-rounded",
				text: "追番页上线：同步 B 站追番追剧数据，每天凌晨自动更新",
			},
			{
				icon: "material-symbols:shuffle-rounded",
				text: "新增 /random 随机阅读，随手翻一篇历史文章",
			},
			{
				icon: "material-symbols:share",
				text: "文章分享卡片自动生成 OG 图，转发出去不再光秃秃",
			},
		],
	},
	{
		date: "2026-10-05",
		title: "安全与后台",
		brief: "看不见的地方先打磨：安全加固 + 后台趁手度升级。",
		tags: ["安全", "后台"],
		items: [
			{
				icon: "material-symbols:security-rounded",
				text: "CSP 收紧、SSRF 加固、路径白名单，robots 屏蔽后台与接口",
			},
			{
				icon: "material-symbols:photo-library-rounded",
				text: "媒体库支持搜索、筛选与分页，删除留审计记录",
			},
			{
				icon: "material-symbols:edit-note-rounded",
				text: "编辑器支持 Ctrl+S 保存、崩溃恢复快照与真 Markdown 预览",
			},
		],
	},
	{
		date: "2026-10-05",
		title: "更像我自己了",
		brief: "有了自己的标语、项目展示和一张真实的个人名片。",
		tags: ["个人化"],
		items: [
			{
				icon: "material-symbols:format-quote-rounded",
				text: "首页标语换成自己的：规则是别人写的，配置文件是我的",
			},
			{
				icon: "material-symbols:construction-rounded",
				text: "工具页新增「本人项目」，关于页项目卡与最近动态全部就位",
			},
			{
				icon: "material-symbols:link-rounded",
				text: "友链页本站信息卡修正，不再指向弃用的旧域名",
			},
		],
	},
	{
		date: "2026-08-28",
		title: "博客初始化完成",
		brief: "正式开站，开始记录学习与生活。",
		tags: ["里程碑"],
		items: [
			{
				icon: "material-symbols:rocket-launch-rounded",
				text: "基于 Astro 深度定制主题上线，后台写作与发布链路就绪",
			},
		],
	},
];
