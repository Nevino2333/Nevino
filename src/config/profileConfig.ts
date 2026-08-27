import type { ProfileConfig } from "../types/profileConfig";

export const profileConfig: ProfileConfig = {
	// 头像
	// 图片路径支持三种格式：
	// 1. public 目录（以 "/" 开头，不优化）："/assets/images/avatar.webp"
	// 2. src 目录（不以 "/" 开头，自动优化但会增加构建时间，推荐）："assets/images/avatar.webp"
	// 3. 远程 URL："https://example.com/avatar.jpg"
	avatar: "/assets/Avater.png",

	// 名字
	name: "Nevino",

	// 个人签名
	bio: "17岁的高中生 · 全栈开发 · 擅长 vibe coding",

	// 链接配置
	// 已经预装的图标集：fa7-brands，fa7-regular，fa7-solid，material-symbols，simple-icons
	// 访问https://icones.js.org/ 获取图标代码，
	// 如果想使用尚未包含相应的图标集，则需要安装它
	// `pnpm add @iconify-json/<icon-set-name>`
	// showName: true 时显示图标和名称，false 时只显示图标
	links: [
		{
			name: "GitHub",
			icon: "fa7-brands:github",
			url: "https://github.com/Nevino2333",
			showName: false,
		},
		{
			name: "Bilibili",
			icon: "simple-icons:bilibili",
			url: "https://b23.tv/qUsPw7x",
			showName: false,
		},
		{
			name: "Email",
			icon: "fa7-solid:envelope",
			url: "mailto:nevino.work@outlook.com",
			showName: false,
		},
		{
			name: "QQ",
			icon: "fa7-brands:qq",
			url: "copy:2745978770",
			showName: false,
		},
		{
			name: "微信",
			icon: "fa7-brands:weixin",
			url: "copy:WJH231582",
			showName: false,
		},
		{
			name: "爱发电",
			icon: "simple-icons:afdian",
			url: "https://ifdian.net/a/Nevino",
			showName: false,
		},
	],
};
