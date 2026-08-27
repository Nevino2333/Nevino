import type { SponsorConfig } from "../types/sponsorConfig";

export const sponsorConfig: SponsorConfig = {
	title: "",
	description: "",
	usage:
		"您的打赏将用于服务器维护、内容创作和功能开发，帮助我持续提供优质内容。",
	showSponsorsList: false,
	showComment: true,
	showButtonInPost: true,
	methods: [
		{
			name: "支付宝",
			icon: "fa7-brands:alipay",
			qrCode: "/assets/images/sponsor/alipay.webp",
			link: "",
			description: "使用 支付宝 扫码打赏",
			enabled: false,
		},
		{
			name: "微信",
			icon: "fa7-brands:weixin",
			qrCode: "/assets/images/sponsor/wechat.webp",
			link: "",
			description: "使用 微信 扫码打赏",
			enabled: false,
		},
		{
			name: "爱发电",
			icon: "simple-icons:afdian",
			qrCode: "",
			link: "https://ifdian.net/a/Nevino",
			description: "通过爱发电支持 Nevino",
			enabled: true,
		},
	],
	sponsors: [],
};
