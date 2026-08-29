// 站点配置分组注册表：每个分组声明它管理的配置文件、字段元数据与解析/补丁方式。
// 字段元数据同时驱动服务端校验和前端表单渲染，新增分组只需在此登记。
// 后台永远不接受前端提供仓库路径或任意源代码 —— 只允许修改这里登记的白名单文件。

import {
	findConstNode,
	finalizeNode,
	isLiteralRef,
	literalEquals,
	patchConstValue,
	type JsonLikeValue,
} from "./json-like";

export type FieldOption = { value: string; label: string };

type FieldBase = {
	key: string;
	label: string;
	help?: string;
};

export type FieldUpload = {
	// 提供时字段旁显示"上传"按钮，accept 为文件选择器的 MIME/扩展名过滤
	accept: string;
};

export type FieldMeta = FieldBase &
	(
		| {
				type: "text" | "textarea" | "url" | "image" | "color";
				required?: boolean;
				maxLength?: number;
				placeholder?: string;
				urlPrefixes?: string[];
				upload?: FieldUpload;
		  }
		| { type: "number"; min?: number; max?: number; integer?: boolean }
		| { type: "boolean" }
		| { type: "select"; options: FieldOption[] }
		| { type: "tags"; maxItems?: number }
		| {
				type: "list";
				itemLabelKey: string;
				fields: FieldMeta[];
				defaultItem: Record<string, unknown>;
				maxItems?: number;
				addable?: boolean;
		  }
	);

export type FieldBinding = {
	// 字段完整标识：`${block}.${path.join(".")}`，也是 payload.values 的键
	id: string;
	block: string;
	path: (string | number)[];
	field: FieldMeta;
};

export type CodeFileBinding = {
	id: string;
	path: string;
	label: string;
	help?: string;
	maxLength: number;
};

export type ConfigGroup = {
	key: string;
	label: string;
	section: "content" | "settings";
	description: string;
	filePath: string;
	fields: FieldBinding[];
	codeFiles?: CodeFileBinding[];
};

const binding = (
	block: string,
	field: FieldMeta,
	explicitPath?: (string | number)[],
): FieldBinding => {
	const path = explicitPath ?? field.key.split(".");
	return {
		id: [block, ...path].join("."),
		block,
		path,
		field,
	};
};

const list = (
	block: string,
	key: string,
	meta: {
		label: string;
		itemLabelKey: string;
		fields: FieldMeta[];
		defaultItem: Record<string, unknown>;
		maxItems?: number;
		help?: string;
	},
	pathOverride?: (string | number)[],
): FieldBinding => {
	// 块本身是数组（如 friendsConfig）时 path 为空；否则 key 是块内成员名
	const path = pathOverride ?? (key === block ? [] : key.split("."));
	return {
		id: [block, ...path].join("."),
		block,
		path,
		field: { key, type: "list", addable: true, ...meta },
	};
};

const text = (
	key: string,
	label: string,
	options?: {
		required?: boolean;
		maxLength?: number;
		help?: string;
		placeholder?: string;
	},
): FieldMeta => ({
	key,
	type: "text",
	label,
	required: options?.required,
	maxLength: options?.maxLength ?? 200,
	help: options?.help,
	placeholder: options?.placeholder,
});

const textarea = (
	key: string,
	label: string,
	options?: { required?: boolean; maxLength?: number; help?: string },
): FieldMeta => ({
	key,
	type: "textarea",
	label,
	required: options?.required,
	maxLength: options?.maxLength ?? 2000,
	help: options?.help,
});

const url = (
	key: string,
	label: string,
	options?: {
		required?: boolean;
		urlPrefixes?: string[];
		help?: string;
		upload?: FieldUpload;
	},
): FieldMeta => ({
	key,
	type: "url",
	label,
	required: options?.required,
	maxLength: 500,
	urlPrefixes: options?.urlPrefixes,
	help: options?.help,
	upload: options?.upload,
});

const number = (
	key: string,
	label: string,
	options?: { min?: number; max?: number; integer?: boolean; help?: string },
): FieldMeta => ({
	key,
	type: "number",
	label,
	min: options?.min,
	max: options?.max,
	integer: options?.integer ?? true,
	help: options?.help,
});

const boolean = (key: string, label: string, help?: string): FieldMeta => ({
	key,
	type: "boolean",
	label,
	help,
});

const select = (
	key: string,
	label: string,
	options: FieldOption[],
	help?: string,
): FieldMeta => ({ key, type: "select", label, options, help });

const tags = (key: string, label: string, help?: string): FieldMeta => ({
	key,
	type: "tags",
	label,
	maxItems: 20,
	help,
});

const SENSITIVE_PATTERNS = [
	"ghp_",
	"github_pat_",
	"AKIA",
	"-----BEGIN",
	"sk-ant-",
	"xoxb-",
	"SESSION_SECRET=",
];

const standardUrlPrefixes = ["http://", "https://", "/"];
const localUrlPrefixes = ["http://", "https://", "/", "mailto:", "copy:"];

export const containsSensitiveValue = (value: JsonLikeValue): boolean => {
	if (typeof value === "string")
		return SENSITIVE_PATTERNS.some((pattern) => value.includes(pattern));
	if (Array.isArray(value))
		return value.some((item) => containsSensitiveValue(item));
	if (typeof value === "object" && value !== null)
		return Object.values(value).some((item) => containsSensitiveValue(item));
	return false;
};

// ---------------------------------------------------------------------------
// 分组定义
// ---------------------------------------------------------------------------

const friendItemFields: FieldMeta[] = [
	text("title", "名称", { required: true, maxLength: 120 }),
	text("desc", "描述", { maxLength: 300 }),
	url("siteurl", "站点地址", {
		required: true,
		urlPrefixes: standardUrlPrefixes,
	}),
	url("imgurl", "头像地址", {
		required: true,
		urlPrefixes: standardUrlPrefixes,
	}),
	url("rss", "RSS/Atom", { urlPrefixes: standardUrlPrefixes }),
	tags("tags", "标签"),
	boolean("recommended", "推荐友链样式"),
	boolean("temporarilyUnavailable", "暂时失联"),
	number("weight", "权重", { min: -1000, max: 1000 }),
	boolean("enabled", "启用"),
];

const toolItemFields: FieldMeta[] = [
	text("name", "工具名称", { required: true, maxLength: 80 }),
	textarea("description", "描述", { maxLength: 400 }),
	text("icon", "图标（Iconify）", { required: true, maxLength: 120 }),
	tags("platforms", "平台"),
	url("url", "链接", { required: true, urlPrefixes: standardUrlPrefixes }),
	boolean("isFree", "免费开源"),
	text("accent", "强调色", { maxLength: 32 }),
	boolean("isMine", "本人项目"),
];

const albumItemFields: FieldMeta[] = [
	text("id", "相册 ID（目录名）", {
		required: true,
		maxLength: 60,
		help: "对应 public/gallery/<id>/ 目录，仅小写字母、数字与连字符",
	}),
	text("name", "相册名称", { required: true, maxLength: 120 }),
	textarea("description", "描述", { maxLength: 500 }),
	text("location", "拍摄地点", { maxLength: 120 }),
	text("date", "日期（YYYY-MM-DD）", { maxLength: 10 }),
	tags("tags", "标签"),
	url("cover", "封面图", { urlPrefixes: standardUrlPrefixes }),
	text("password", "访问密码", {
		maxLength: 60,
		help: "设置后前台需要输入密码才能查看相册",
	}),
	text("passwordHint", "密码提示", { maxLength: 120 }),
];

const sponsorMethodFields: FieldMeta[] = [
	text("name", "名称", { required: true, maxLength: 60 }),
	text("icon", "图标（Iconify）", { maxLength: 120 }),
	url("qrCode", "收款码图片", { urlPrefixes: standardUrlPrefixes }),
	url("link", "跳转链接", { urlPrefixes: standardUrlPrefixes }),
	text("description", "描述", { maxLength: 200 }),
	boolean("enabled", "启用"),
];

const sponsorItemFields: FieldMeta[] = [
	text("name", "名称", { required: true, maxLength: 80 }),
	url("avatar", "头像", { urlPrefixes: localUrlPrefixes }),
	text("amount", "金额", { maxLength: 40 }),
	text("date", "日期（YYYY-MM-DD）", { maxLength: 10 }),
];

const profileLinkFields: FieldMeta[] = [
	text("name", "名称", { required: true, maxLength: 60 }),
	text("icon", "图标（Iconify）", { required: true, maxLength: 120 }),
	url("url", "链接", {
		required: true,
		urlPrefixes: localUrlPrefixes,
		help: "支持 https://、mailto:，或 copy: 前缀表示点击复制",
	}),
	boolean("showName", "显示名称"),
];

export const CONFIG_GROUPS: ConfigGroup[] = [
	{
		key: "friends",
		label: "友链",
		section: "content",
		description: "管理友链页面配置、友链列表与已加入的博客项目。",
		filePath: "src/config/friendsConfig.ts",
		fields: [
			binding(
				"friendsPageConfig",
				text("title", "页面标题", { maxLength: 120 }),
			),
			binding(
				"friendsPageConfig",
				textarea("description", "页面描述", { maxLength: 400 }),
			),
			binding(
				"friendsPageConfig",
				boolean("showCustomContent", "显示自定义内容"),
			),
			binding("friendsPageConfig", boolean("showComment", "显示评论区")),
			binding("friendsPageConfig", boolean("randomizeSort", "随机排序")),
			list("friendsConfig", "friendsConfig", {
				label: "友链列表",
				itemLabelKey: "title",
				fields: friendItemFields,
				defaultItem: {
					title: "",
					desc: "",
					siteurl: "",
					imgurl: "",
					rss: "",
					tags: [],
					recommended: false,
					temporarilyUnavailable: false,
					weight: 0,
					enabled: true,
				},
				maxItems: 200,
			}),
			list("friendsProjects", "friendsProjects", {
				label: "已加入的博客项目",
				itemLabelKey: "title",
				fields: friendItemFields,
				defaultItem: {
					title: "",
					desc: "",
					siteurl: "",
					imgurl: "",
					rss: "",
					tags: [],
					recommended: false,
					temporarilyUnavailable: false,
					weight: 0,
					enabled: true,
				},
				maxItems: 100,
			}),
		],
	},
	{
		key: "gallery",
		label: "相册",
		section: "content",
		description: "管理相册元数据；照片文件仍需放入 public/gallery/<id>/ 目录。",
		filePath: "src/config/galleryConfig.ts",
		fields: [
			list("galleryConfig", "albums", {
				label: "相册列表",
				itemLabelKey: "name",
				fields: albumItemFields,
				defaultItem: {
					id: "",
					name: "",
					description: "",
					location: "",
					date: "",
					tags: [],
					cover: "",
					password: "",
					passwordHint: "",
				},
				maxItems: 100,
			}),
			binding(
				"galleryConfig",
				number("columnWidth", "瀑布流最小列宽(px)", { min: 120, max: 800 }),
			),
		],
	},
	{
		key: "announcement",
		label: "公告",
		section: "content",
		description: "侧栏公告卡片的标题、内容与链接。",
		filePath: "src/config/announcementConfig.ts",
		fields: [
			binding(
				"announcementConfig",
				text("title", "公告标题", { maxLength: 120 }),
			),
			binding(
				"announcementConfig",
				textarea("content", "公告内容", { maxLength: 1000 }),
			),
			binding("announcementConfig", boolean("closable", "允许访客关闭公告")),
			binding("announcementConfig", boolean("link.enable", "启用链接")),
			binding(
				"announcementConfig",
				text("link.text", "链接文本", { maxLength: 60 }),
			),
			binding(
				"announcementConfig",
				url("link.url", "链接地址", { urlPrefixes: standardUrlPrefixes }),
			),
			binding("announcementConfig", boolean("link.external", "外部链接")),
		],
	},
	{
		key: "sponsor",
		label: "赞助",
		section: "content",
		description: "打赏方式、赞助者名单与打赏页开关。",
		filePath: "src/config/sponsorConfig.ts",
		fields: [
			binding("sponsorConfig", text("title", "页面标题", { maxLength: 120 })),
			binding(
				"sponsorConfig",
				textarea("description", "页面描述", { maxLength: 400 }),
			),
			binding(
				"sponsorConfig",
				textarea("usage", "打赏用途说明", { maxLength: 600 }),
			),
			binding("sponsorConfig", boolean("showSponsorsList", "显示赞助者列表")),
			binding("sponsorConfig", boolean("showComment", "显示评论区")),
			binding(
				"sponsorConfig",
				boolean("showButtonInPost", "文章页显示打赏按钮"),
			),
			list("sponsorConfig", "methods", {
				label: "打赏方式",
				itemLabelKey: "name",
				fields: sponsorMethodFields,
				defaultItem: {
					name: "",
					icon: "",
					qrCode: "",
					link: "",
					description: "",
					enabled: false,
				},
				maxItems: 20,
			}),
			list("sponsorConfig", "sponsors", {
				label: "赞助者名单",
				itemLabelKey: "name",
				fields: sponsorItemFields,
				defaultItem: { name: "", avatar: "", amount: "", date: "" },
				maxItems: 200,
			}),
		],
	},
	{
		key: "tools",
		label: "工具页",
		section: "content",
		description: "工具页展示的本人项目与第三方工具清单。",
		filePath: "src/config/toolsConfig.ts",
		fields: [
			list("myTools", "myTools", {
				label: "本人项目",
				itemLabelKey: "name",
				fields: toolItemFields,
				defaultItem: {
					name: "",
					description: "",
					icon: "",
					platforms: [],
					url: "",
					isFree: true,
					accent: "#3b82f6",
					isMine: true,
				},
				maxItems: 100,
			}),
			list("thirdPartyTools", "thirdPartyTools", {
				label: "第三方工具",
				itemLabelKey: "name",
				fields: toolItemFields,
				defaultItem: {
					name: "",
					description: "",
					icon: "",
					platforms: [],
					url: "",
					isFree: true,
					accent: "#64748b",
					isMine: false,
				},
				maxItems: 300,
			}),
		],
	},
	{
		key: "music",
		label: "音乐",
		section: "content",
		description:
			"音乐播放器模式、播放列表与 Meting API 配置；音频与歌词文件仍需放入 public/assets/music/。",
		filePath: "src/config/musicConfig.ts",
		fields: [
			binding("musicPlayerConfig", boolean("showInNavbar", "导航栏显示播放器入口")),
			binding(
				"musicPlayerConfig",
				select("mode", "播放源模式", [
					{ value: "meting", label: "Meting API" },
					{ value: "local", label: "本地播放列表" },
				]),
			),
			binding(
				"musicPlayerConfig",
				number("volume", "默认音量", { min: 0, max: 1, integer: false, help: "0-1 之间的小数" }),
			),
			binding(
				"musicPlayerConfig",
				select("playMode", "播放模式", [
					{ value: "list", label: "列表循环" },
					{ value: "one", label: "单曲循环" },
					{ value: "random", label: "随机播放" },
				]),
			),
			binding("musicPlayerConfig", boolean("showLyrics", "显示歌词")),
			binding(
				"musicPlayerConfig",
				url("meting.api", "Meting API 地址", { urlPrefixes: ["http://", "https://"] }),
			),
			binding(
				"musicPlayerConfig",
				select("meting.server", "音乐平台", [
					{ value: "netease", label: "网易云音乐" },
					{ value: "tencent", label: "QQ音乐" },
					{ value: "kugou", label: "酷狗音乐" },
					{ value: "baidu", label: "百度音乐" },
				]),
			),
			binding(
				"musicPlayerConfig",
				select("meting.type", "资源类型", [
					{ value: "song", label: "单曲" },
					{ value: "playlist", label: "歌单" },
					{ value: "album", label: "专辑" },
					{ value: "search", label: "搜索" },
					{ value: "artist", label: "艺术家" },
				]),
			),
			binding("musicPlayerConfig", text("meting.id", "歌单/单曲 ID", { maxLength: 120 })),
			binding(
				"musicPlayerConfig",
				tags("meting.fallbackApis", "备用 API 列表", "每项一个完整的 Meting API 地址"),
			),
			list("musicPlayerConfig", "local.playlist", {
				label: "本地播放列表",
				itemLabelKey: "name",
				fields: [
					text("name", "歌曲名", { required: true, maxLength: 120 }),
					text("artist", "艺术家", { maxLength: 160 }),
					url("url", "音频地址", {
						required: true,
						urlPrefixes: ["http://", "https://", "/"],
						help: "上传音频或填写 public/assets/music/ 下的路径、外链",
						upload: { accept: "audio/mpeg,audio/flac,audio/ogg,audio/wav,audio/mp4" },
					}),
					url("cover", "封面图", {
						urlPrefixes: standardUrlPrefixes,
						upload: { accept: "image/png,image/jpeg,image/webp,image/gif" },
					}),
					url("lrc", "歌词文件或内容", {
						urlPrefixes: localUrlPrefixes,
						help: "上传 .lrc 文件、填写路径，或直接粘贴歌词内容",
						upload: { accept: ".lrc,text/plain" },
					}),
				],
				defaultItem: { name: "", artist: "", url: "", cover: "", lrc: "" },
				maxItems: 200,
			}),
		],
	},
	{
		key: "wallpaper",
		label: "壁纸与横幅",
		section: "settings",
		description:
			"壁纸模式、横幅文字与导航栏、轮播参数；桌面/移动壁纸图片列表由仓库代码生成，后台以只读呈现。",
		filePath: "src/config/backgroundWallpaper.ts",
		fields: [
			binding(
				"backgroundWallpaper",
				select("mode", "壁纸模式", [
					{ value: "banner", label: "横幅壁纸" },
					{ value: "fullscreen", label: "全屏壁纸" },
					{ value: "overlay", label: "全屏透明" },
					{ value: "none", label: "纯色背景" },
				]),
			),
			binding("backgroundWallpaper", boolean("switchable", "允许访客切换壁纸模式")),
			binding("backgroundWallpaper", boolean("playerEnable", "启用背景视频播放")),
			binding(
				"backgroundWallpaper",
				tags("src.playerUrl", "背景视频地址", "支持单个或多个视频 URL"),
			),
			binding(
				"backgroundWallpaper",
				number("common.dimOpacity", "壁纸遮罩暗度", { min: 0, max: 1, integer: false }),
			),
			binding(
				"backgroundWallpaper",
				select("common.playerMode", "多视频播放模式", [
					{ value: "order", label: "顺序循环" },
					{ value: "random", label: "随机切换" },
				]),
			),
			binding("backgroundWallpaper", boolean("common.homeText.enable", "显示主页横幅文字")),
			binding(
				"backgroundWallpaper",
				boolean("common.homeText.switchable", "允许访客切换横幅文字"),
			),
			binding("backgroundWallpaper", text("common.homeText.title", "横幅主标题", { maxLength: 120 })),
			binding(
				"backgroundWallpaper",
				text("common.homeText.titleSize", "主标题字号（CSS 值）", { maxLength: 20 }),
			),
			binding("backgroundWallpaper", tags("common.homeText.subtitle", "横幅副标题句子")),
			binding(
				"backgroundWallpaper",
				text("common.homeText.subtitleSize", "副标题字号（CSS 值）", { maxLength: 20 }),
			),
			binding(
				"backgroundWallpaper",
				boolean("common.homeText.typewriter.enable", "副标题打字机效果"),
			),
			binding(
				"backgroundWallpaper",
				number("common.homeText.typewriter.speed", "打字速度（毫秒）", { min: 10, max: 1000 }),
			),
			binding(
				"backgroundWallpaper",
				number("common.homeText.typewriter.deleteSpeed", "删除速度（毫秒）", { min: 10, max: 1000 }),
			),
			binding(
				"backgroundWallpaper",
				number("common.homeText.typewriter.pauseTime", "显示后暂停（毫秒）", { min: 0, max: 10000 }),
			),
			binding(
				"backgroundWallpaper",
				select("common.navbar.transparentMode", "导航栏透明模式", [
					{ value: "semi", label: "半透明" },
					{ value: "full", label: "完全透明" },
					{ value: "semifull", label: "动态透明" },
				]),
			),
			binding("backgroundWallpaper", boolean("common.navbar.enableBlur", "导航栏毛玻璃模糊")),
			binding("backgroundWallpaper", number("common.navbar.blur", "毛玻璃模糊度", { min: 0, max: 30 })),
			binding("backgroundWallpaper", boolean("common.waves.enable.desktop", "水波纹（桌面）")),
			binding("backgroundWallpaper", boolean("common.waves.enable.mobile", "水波纹（移动端）")),
			binding("backgroundWallpaper", boolean("common.waves.switchable", "允许访客切换水波纹")),
			binding("backgroundWallpaper", boolean("common.gradient.enable.desktop", "渐变过渡（桌面）")),
			binding("backgroundWallpaper", boolean("common.gradient.enable.mobile", "渐变过渡（移动端）")),
			binding("backgroundWallpaper", text("common.gradient.height", "渐变高度（CSS 值）", { maxLength: 20 })),
			binding("backgroundWallpaper", boolean("common.carousel.enable", "启用壁纸轮播")),
			binding(
				"backgroundWallpaper",
				number("common.carousel.interval", "轮播间隔（毫秒）", { min: 1000, max: 60000 }),
			),
			binding(
				"backgroundWallpaper",
				select("common.carousel.transitionEffect", "轮播过渡效果", [
					{ value: "fade", label: "渐变" },
					{ value: "zoom", label: "缩放" },
					{ value: "slide", label: "滑动" },
					{ value: "kenburns", label: "旋转木马" },
				]),
			),
			binding("backgroundWallpaper", text("banner.position", "横幅图片位置（CSS 值）", { maxLength: 40 })),
			binding(
				"backgroundWallpaper",
				text("fullscreen.position", "全屏图片位置（CSS 值）", { maxLength: 40 }),
			),
			binding(
				"backgroundWallpaper",
				number("overlay.opacity", "透明模式壁纸不透明度", { min: 0, max: 1, integer: false }),
			),
			binding("backgroundWallpaper", number("overlay.blur", "透明模式背景模糊", { min: 0, max: 40 })),
			binding(
				"backgroundWallpaper",
				number("overlay.cardOpacity", "透明模式卡片不透明度", { min: 0, max: 1, integer: false }),
			),
		],
	},
	{
		key: "effects",
		label: "樱花特效",
		section: "settings",
		description: "樱花飘落动画的开关与数量、速度等参数。",
		filePath: "src/config/effectsConfig.ts",
		fields: [
			binding("sakuraConfig", boolean("enable", "启用樱花特效")),
			binding("sakuraConfig", boolean("switchable", "允许访客切换特效")),
			binding("sakuraConfig", number("sakuraNum", "樱花数量", { min: 0, max: 100 })),
			binding(
				"sakuraConfig",
				number("limitTimes", "越界限制次数", { min: -1, max: 1000, help: "-1 为无限循环" }),
			),
			binding("sakuraConfig", number("size.min", "尺寸倍数下限", { min: 0.1, max: 3, integer: false })),
			binding("sakuraConfig", number("size.max", "尺寸倍数上限", { min: 0.1, max: 3, integer: false })),
			binding("sakuraConfig", number("opacity.min", "不透明度下限", { min: 0, max: 1, integer: false })),
			binding("sakuraConfig", number("opacity.max", "不透明度上限", { min: 0, max: 1, integer: false })),
			binding(
				"sakuraConfig",
				number("speed.horizontal.min", "水平速度下限", { min: -10, max: 10, integer: false }),
			),
			binding(
				"sakuraConfig",
				number("speed.horizontal.max", "水平速度上限", { min: -10, max: 10, integer: false }),
			),
			binding(
				"sakuraConfig",
				number("speed.vertical.min", "垂直速度下限", { min: 0, max: 10, integer: false }),
			),
			binding(
				"sakuraConfig",
				number("speed.vertical.max", "垂直速度上限", { min: 0, max: 10, integer: false }),
			),
			binding("sakuraConfig", number("speed.rotation", "旋转速度", { min: -1, max: 1, integer: false })),
			binding("sakuraConfig", number("speed.fadeSpeed", "消失速度", { min: 0, max: 1, integer: false })),
			binding("sakuraConfig", number("zIndex", "显示层级", { min: -1, max: 10000 })),
		],
	},
	{
		key: "pio",
		label: "看板娘",
		section: "settings",
		description:
			"Spine 与 Live2D 看板娘的开关、位置与互动文案；模型文件仍需放入 public/pio/models/。",
		filePath: "src/config/pioConfig.ts",
		fields: [
			binding("spineModelConfig", boolean("enable", "启用 Spine 看板娘")),
			binding("spineModelConfig", text("model.path", "模型文件路径", { maxLength: 300 })),
			binding(
				"spineModelConfig",
				number("model.scale", "模型缩放", { min: 0.1, max: 5, integer: false }),
			),
			binding(
				"spineModelConfig",
				select("position.corner", "显示位置", [
					{ value: "bottom-left", label: "左下角" },
					{ value: "bottom-right", label: "右下角" },
					{ value: "top-left", label: "左上角" },
					{ value: "top-right", label: "右上角" },
				]),
			),
			binding("spineModelConfig", number("position.offsetX", "水平偏移（px）", { min: -200, max: 200 })),
			binding("spineModelConfig", number("position.offsetY", "垂直偏移（px）", { min: -200, max: 200 })),
			binding("spineModelConfig", number("size.width", "容器宽度（px）", { min: 50, max: 600 })),
			binding("spineModelConfig", number("size.height", "容器高度（px）", { min: 50, max: 800 })),
			binding("spineModelConfig", boolean("interactive.enabled", "启用点击互动")),
			binding("spineModelConfig", tags("interactive.clickAnimations", "点击播放的动画列表")),
			binding("spineModelConfig", tags("interactive.clickMessages", "点击显示的文案")),
			binding(
				"spineModelConfig",
				number("interactive.messageDisplayTime", "文案显示时长（毫秒）", { min: 500, max: 20000 }),
			),
			binding("spineModelConfig", tags("interactive.idleAnimations", "待机动画列表")),
			binding(
				"spineModelConfig",
				number("interactive.idleInterval", "待机动画切换间隔（毫秒）", { min: 1000, max: 60000 }),
			),
			binding("spineModelConfig", boolean("responsive.hideOnMobile", "移动端隐藏")),
			binding(
				"spineModelConfig",
				number("responsive.mobileBreakpoint", "移动端断点（px）", { min: 320, max: 1280 }),
			),
			binding("spineModelConfig", number("opacity", "不透明度", { min: 0.1, max: 1, integer: false })),
			binding("live2dWidgetConfig", boolean("enable", "启用 Live2D 看板娘")),
			binding(
				"live2dWidgetConfig",
				select("position", "显示位置", [
					{ value: "bottom-left", label: "左下角" },
					{ value: "bottom-right", label: "右下角" },
				]),
			),
			binding("live2dWidgetConfig", number("size.width", "画布宽度（px）", { min: 100, max: 500 })),
			binding("live2dWidgetConfig", number("size.height", "画布高度（px）", { min: 100, max: 500 })),
			binding("live2dWidgetConfig", boolean("tips.enable", "启用提示气泡")),
			binding("live2dWidgetConfig", tags("tips.welcomeMessage", "欢迎消息")),
			binding("live2dWidgetConfig", tags("tips.messages", "循环提示文案")),
			binding("live2dWidgetConfig", number("tips.duration", "文案显示时长（毫秒）", { min: 500, max: 20000 })),
			binding(
				"live2dWidgetConfig",
				number("tips.interval", "气泡切换间隔（毫秒）", { min: 1000, max: 60000 }),
			),
			binding("live2dWidgetConfig", boolean("responsive.hideOnMobile", "移动端隐藏")),
			binding(
				"live2dWidgetConfig",
				number("responsive.mobileBreakpoint", "移动端断点（px）", { min: 320, max: 1280 }),
			),
		],
	},
	{
		key: "covers",
		label: "文章封面",
		section: "settings",
		description:
			'文章详情页封面展示与随机封面 API；文章 Frontmatter 中 image: "api" 即可使用随机图。',
		filePath: "src/config/coverImageConfig.ts",
		fields: [
			binding("coverImageConfig", boolean("enableInPost", "文章详情页显示封面")),
			binding("coverImageConfig", boolean("randomCoverImage.enable", "启用随机封面图")),
			binding("coverImageConfig", tags("randomCoverImage.apis", "随机封面 API 列表")),
			binding(
				"coverImageConfig",
				url("randomCoverImage.fallback", "API 失败回退图片", { urlPrefixes: localUrlPrefixes }),
			),
			binding("coverImageConfig", boolean("randomCoverImage.showLoading", "显示加载动画")),
		],
	},
	{
		key: "intro",
		label: "首页开屏",
		section: "settings",
		description:
			"首页开屏动画的默认角色、横幅与角色图列表；图片文件仍需放入 public/assets/images/home-truncated/。",
		filePath: "src/config/homePortfolioIntro.ts",
		fields: [
			binding("homePortfolioIntroSettings", boolean("defaultEnabled", "默认播放开屏动画")),
			binding("homePortfolioIntroSettings", text("defaultCharacterId", "默认角色 ID", { maxLength: 60 })),
			binding(
				"homePortfolioIntroSettings",
				text("defaultTopBannerId", "桌面顶部横幅 ID", { maxLength: 60 }),
			),
			binding(
				"homePortfolioIntroSettings",
				text("defaultBottomBannerId", "桌面底部横幅 ID", { maxLength: 60 }),
			),
			binding(
				"homePortfolioIntroSettings",
				text("defaultMobileTopBannerId", "移动顶部横幅 ID", { maxLength: 60 }),
			),
			binding(
				"homePortfolioIntroSettings",
				text("defaultMobileBottomBannerId", "移动底部横幅 ID", { maxLength: 60 }),
			),
			list("homePortfolioIntroSettings", "characters", {
				label: "角色列表",
				itemLabelKey: "label",
				fields: [
					text("id", "角色 ID", { required: true, maxLength: 60 }),
					text("label", "显示名称", { required: true, maxLength: 60 }),
					url("src", "立绘图片", { required: true, urlPrefixes: standardUrlPrefixes }),
					url("thumbnail", "缩略图", { urlPrefixes: standardUrlPrefixes }),
				],
				defaultItem: { id: "", label: "", src: "", thumbnail: "" },
				maxItems: 30,
			}),
binding(
			"homePortfolioIntroSettings",
			{
				key: "banners.desktop.top",
				type: "list",
				label: "桌面顶部横幅",
				itemLabelKey: "label",
				addable: true,
				fields: [
					text("id", "横幅 ID", { required: true, maxLength: 60 }),
					text("label", "显示名称", { required: true, maxLength: 60 }),
					url("src", "图片", { required: true, urlPrefixes: standardUrlPrefixes }),
				],
				defaultItem: { id: "", label: "", src: "" },
				maxItems: 30,
			},
			["banners", "desktop", "top"],
		),
binding(
			"homePortfolioIntroSettings",
			{
				key: "banners.desktop.bottom",
				type: "list",
				label: "桌面底部横幅",
				itemLabelKey: "label",
				addable: true,
				fields: [
					text("id", "横幅 ID", { required: true, maxLength: 60 }),
					text("label", "显示名称", { required: true, maxLength: 60 }),
					url("src", "图片", { required: true, urlPrefixes: standardUrlPrefixes }),
				],
				defaultItem: { id: "", label: "", src: "" },
				maxItems: 30,
			},
			["banners", "desktop", "bottom"],
		),
binding(
			"homePortfolioIntroSettings",
			{
				key: "banners.mobile.top",
				type: "list",
				label: "移动顶部横幅",
				itemLabelKey: "label",
				addable: true,
				fields: [
					text("id", "横幅 ID", { required: true, maxLength: 60 }),
					text("label", "显示名称", { required: true, maxLength: 60 }),
					url("src", "图片", { required: true, urlPrefixes: standardUrlPrefixes }),
				],
				defaultItem: { id: "", label: "", src: "" },
				maxItems: 30,
			},
			["banners", "mobile", "top"],
		),
binding(
			"homePortfolioIntroSettings",
			{
				key: "banners.mobile.bottom",
				type: "list",
				label: "移动底部横幅",
				itemLabelKey: "label",
				addable: true,
				fields: [
					text("id", "横幅 ID", { required: true, maxLength: 60 }),
					text("label", "显示名称", { required: true, maxLength: 60 }),
					url("src", "图片", { required: true, urlPrefixes: standardUrlPrefixes }),
				],
				defaultItem: { id: "", label: "", src: "" },
				maxItems: 30,
			},
			["banners", "mobile", "bottom"],
		),
		],
	},
	{
		key: "expressiveCode",
		label: "代码高亮",
		section: "settings",
		description: "Expressive Code 亮暗主题与代码块折叠、语言徽章插件。",
		filePath: "src/config/expressiveCodeConfig.ts",
		fields: [
			binding(
				"expressiveCodeConfig",
				text("darkTheme", "暗色主题名", {
					required: true,
					maxLength: 60,
					help: "参见 expressive-code 官方主题列表",
				}),
			),
			binding("expressiveCodeConfig", text("lightTheme", "亮色主题名", { required: true, maxLength: 60 })),
			binding("expressiveCodeConfig", boolean("pluginCollapsible.enable", "启用代码块折叠")),
			binding(
				"expressiveCodeConfig",
				number("pluginCollapsible.lineThreshold", "折叠按钮行数阈值", { min: 1, max: 200 }),
			),
			binding(
				"expressiveCodeConfig",
				number("pluginCollapsible.previewLines", "折叠时预览行数", { min: 1, max: 50 }),
			),
			binding("expressiveCodeConfig", boolean("pluginCollapsible.defaultCollapsed", "长代码块默认折叠")),
			binding("expressiveCodeConfig", boolean("pluginLanguageBadge.enable", "启用语言徽章")),
		],
	},
	{
		key: "plantuml",
		label: "PlantUML",
		section: "settings",
		description: "PlantUML 图表渲染开关、服务器地址与明暗主题。",
		filePath: "src/config/plantumlConfig.ts",
		fields: [
			binding("plantumlConfig", boolean("enable", "启用 PlantUML 渲染")),
			binding(
				"plantumlConfig",
				url("server", "PlantUML 服务器地址", {
					required: true,
					urlPrefixes: ["http://", "https://"],
				}),
			),
			binding("plantumlConfig", text("lightTheme", "亮色主题名（留空使用默认）", { maxLength: 60 })),
			binding("plantumlConfig", text("darkTheme", "暗色主题名（留空使用默认）", { maxLength: 60 })),
		],
	},
	{
		key: "font",
		label: "字体",
		section: "settings",
		description:
			"自定义字体开关与全局/分区字体选择；字体定义列表（fontsList）与子集化配置仍由仓库维护。",
		filePath: "src/config/fontConfig.ts",
		fields: [
			binding("fontConfig", boolean("enable", "启用自定义字体")),
			binding(
				"fontConfig",
				tags("selected", "全局字体 CSS 变量", "填 fontsList 中的 cssVariable，填 system 使用系统字体"),
			),
			binding("fontConfig", text("bannerTitleFont", "横幅主标题字体", { maxLength: 60 })),
			binding("fontConfig", text("bannerSubtitleFont", "横幅副标题字体", { maxLength: 60 })),
			binding("fontConfig", text("navbarTitleFont", "导航栏标题字体", { maxLength: 60 })),
			binding("fontConfig", text("codeFont", "代码块字体", { maxLength: 60 })),
		],
	},

	{
		key: "site",
		label: "站点信息",
		section: "settings",
		description: "站点标题、描述、页面开关与文章列表布局等核心设置。",
		filePath: "src/config/siteConfig.ts",
		fields: [
			binding(
				"siteConfig",
				text("title", "站点标题", { required: true, maxLength: 100 }),
			),
			binding("siteConfig", text("subtitle", "站点副标题", { maxLength: 200 })),
			binding(
				"siteConfig",
				textarea("description", "站点描述", { maxLength: 400 }),
			),
			binding("siteConfig", tags("keywords", "站点关键词")),
			binding(
				"siteConfig",
				url("site_url", "站点 URL", {
					required: true,
					urlPrefixes: ["http://", "https://"],
				}),
			),
			binding(
				"siteConfig",
				text("timezone", "时区（IANA）", { maxLength: 64 }),
			),
			binding(
				"siteConfig",
				text("siteStartDate", "建站日期（YYYY-MM-DD）", { maxLength: 10 }),
			),
			binding(
				"siteConfig",
				number("themeColor.hue", "主题色色相", { min: 0, max: 360 }),
			),
			binding("siteConfig", boolean("themeColor.fixed", "隐藏主题色选择器")),
			binding(
				"siteConfig",
				select("themeColor.defaultMode", "默认外观模式", [
					{ value: "light", label: "亮色" },
					{ value: "dark", label: "暗色" },
					{ value: "system", label: "跟随系统" },
				]),
			),
			binding(
				"siteConfig",
				text("navbar.title", "导航栏标题", { maxLength: 100 }),
			),
			binding("siteConfig", boolean("pages.friends", "友链页面")),
			binding("siteConfig", boolean("pages.sponsor", "打赏页面")),
			binding("siteConfig", boolean("pages.guestbook", "留言板页面")),
			binding("siteConfig", boolean("pages.bangumi", "番组计划页面")),
			binding("siteConfig", boolean("pages.gallery", "相册页面")),
			binding("siteConfig", boolean("pages.anime", "追番页面")),
			binding("siteConfig", boolean("categoryBar", "分类快捷导航")),
			binding("siteConfig", boolean("foldArticle", "归档页折叠旧年份")),
			binding(
				"siteConfig",
				number("pagination.postsPerPage", "每页文章数", { min: 1, max: 100 }),
			),
			binding(
				"siteConfig",
				select("postListLayout.defaultMode", "列表布局（桌面）", [
					{ value: "list", label: "列表" },
					{ value: "grid", label: "网格" },
				]),
			),
			binding(
				"siteConfig",
				select("postListLayout.mobileDefaultMode", "列表布局（移动端）", [
					{ value: "list", label: "列表" },
					{ value: "grid", label: "网格" },
				]),
			),
			binding("siteConfig", boolean("postListLayout.showTags", "显示标签")),
			binding(
				"siteConfig",
				number("postListLayout.tagCount", "最多标签数", { min: 0, max: 10 }),
			),
			binding(
				"siteConfig",
				number("postListLayout.descriptionLines", "摘要行数", {
					min: 0,
					max: 10,
				}),
			),
			binding(
				"siteConfig",
				boolean("postListLayout.grid.masonry", "瀑布流布局"),
			),
			binding(
				"siteConfig",
				number("postListLayout.grid.columnWidth", "网格最小列宽(px)", {
					min: 200,
					max: 800,
				}),
			),
			binding(
				"siteConfig",
				boolean("post.showLastModified", "显示上次编辑时间"),
			),
			binding(
				"siteConfig",
				number("post.outdatedThreshold", "过期提示阈值（天）", {
					min: 0,
					max: 3650,
				}),
			),
			binding("siteConfig", boolean("post.sharePoster", "分享海报")),
			binding("siteConfig", boolean("post.generateOgImages", "生成 OG 图片")),
		],
	},
	{
		key: "profile",
		label: "个人资料",
		section: "settings",
		description: "头像、名字、签名与社交链接。",
		filePath: "src/config/profileConfig.ts",
		fields: [
			binding(
				"profileConfig",
				url("avatar", "头像地址", { urlPrefixes: standardUrlPrefixes }),
			),
			binding(
				"profileConfig",
				text("name", "名字", { required: true, maxLength: 80 }),
			),
			binding("profileConfig", textarea("bio", "个人签名", { maxLength: 300 })),
			list("profileConfig", "links", {
				label: "社交链接",
				itemLabelKey: "name",
				fields: profileLinkFields,
				defaultItem: { name: "", icon: "", url: "", showName: false },
				maxItems: 30,
			}),
		],
	},
	{
		key: "comment",
		label: "评论系统",
		section: "settings",
		description: "评论系统选择与对应服务参数。",
		filePath: "src/config/commentConfig.ts",
		fields: [
			binding(
				"commentConfig",
				select("type", "评论系统", [
					{ value: "none", label: "关闭" },
					{ value: "waline", label: "Waline" },
					{ value: "twikoo", label: "Twikoo" },
					{ value: "giscus", label: "Giscus" },
					{ value: "disqus", label: "Disqus" },
					{ value: "artalk", label: "Artalk" },
				]),
			),
			binding(
				"commentConfig",
				url("waline.serverURL", "Waline 服务地址", {
					urlPrefixes: ["http://", "https://"],
				}),
			),
			binding(
				"commentConfig",
				select("waline.login", "Waline 登录模式", [
					{ value: "enable", label: "允许匿名与 OAuth" },
					{ value: "force", label: "强制登录" },
					{ value: "disable", label: "仅匿名评论" },
				]),
			),
			binding(
				"commentConfig",
				url("twikoo.envId", "Twikoo 环境地址", {
					urlPrefixes: ["http://", "https://"],
				}),
			),
			binding(
				"commentConfig",
				url("artalk.server", "Artalk 服务地址", {
					urlPrefixes: ["http://", "https://"],
				}),
			),
			binding(
				"commentConfig",
				text("disqus.shortname", "Disqus Shortname", { maxLength: 120 }),
			),
			binding(
				"commentConfig",
				text("giscus.repo", "Giscus 仓库", { maxLength: 160 }),
			),
			binding(
				"commentConfig",
				text("giscus.repoId", "Giscus 仓库 ID", { maxLength: 80 }),
			),
			binding(
				"commentConfig",
				text("giscus.category", "Giscus 分类", { maxLength: 80 }),
			),
			binding(
				"commentConfig",
				text("giscus.categoryId", "Giscus 分类 ID", { maxLength: 80 }),
			),
			binding(
				"commentConfig",
				select("giscus.mapping", "Giscus 映射方式", [
					{ value: "title", label: "标题" },
					{ value: "pathname", label: "路径" },
					{ value: "URL", label: "URL" },
					{ value: "number", label: "Discussion 编号" },
				]),
			),
			binding(
				"commentConfig",
				select("giscus.inputPosition", "评论输入框位置", [
					{ value: "top", label: "顶部" },
					{ value: "bottom", label: "底部" },
				]),
			),
			binding(
				"commentConfig",
				select("giscus.themeLight", "亮色模式评论主题", [
					{ value: "light", label: "亮色" },
					{ value: "light_high_contrast", label: "亮色（高对比）" },
					{ value: "light_protanopia", label: "亮色（红绿色盲友好）" },
					{ value: "light_tritanopia", label: "亮色（蓝黄色盲友好）" },
					{ value: "noborder_light", label: "亮色（无边框，融入卡片）" },
					{ value: "noborder_grayscale", label: "亮色（无边框灰度）" },
					{ value: "dark", label: "暗色" },
					{ value: "dark_high_contrast", label: "暗色（高对比）" },
					{ value: "dark_dimmed", label: "暗色（柔和）" },
					{ value: "transparent_dark", label: "暗色（透明，融入卡片）" },
					{ value: "noborder_dark", label: "暗色（无边框）" },
					{ value: "dark_grayscale", label: "暗色（灰度）" },
					{ value: "preferred_color_scheme", label: "跟随系统" },
				]),
			),
			binding(
				"commentConfig",
				select("giscus.themeDark", "暗色模式评论主题", [
					{ value: "light", label: "亮色" },
					{ value: "light_high_contrast", label: "亮色（高对比）" },
					{ value: "light_protanopia", label: "亮色（红绿色盲友好）" },
					{ value: "light_tritanopia", label: "亮色（蓝黄色盲友好）" },
					{ value: "noborder_light", label: "亮色（无边框，融入卡片）" },
					{ value: "noborder_grayscale", label: "亮色（无边框灰度）" },
					{ value: "dark", label: "暗色" },
					{ value: "dark_high_contrast", label: "暗色（高对比）" },
					{ value: "dark_dimmed", label: "暗色（柔和）" },
					{ value: "transparent_dark", label: "暗色（透明，融入卡片）" },
					{ value: "noborder_dark", label: "暗色（无边框）" },
					{ value: "dark_grayscale", label: "暗色（灰度）" },
					{ value: "preferred_color_scheme", label: "跟随系统" },
				]),
			),
		],
	},
	{
		key: "analytics",
		label: "访问统计",
		section: "settings",
		description: "统计服务 ID 与站点统计卡片的展示开关。",
		filePath: "src/config/analyticsConfig.ts",
		fields: [
			binding(
				"analyticsConfig",
				text("googleAnalyticsId", "Google Analytics ID", { maxLength: 60 }),
			),
			binding(
				"analyticsConfig",
				text("microsoftClarityId", "Microsoft Clarity ID", { maxLength: 60 }),
			),
			binding(
				"analyticsConfig",
				text("umamiAnalytics.websiteId", "Umami Website ID", { maxLength: 80 }),
			),
			binding(
				"analyticsConfig",
				url("umamiAnalytics.scriptUrl", "Umami 脚本地址", {
					urlPrefixes: ["http://", "https://"],
				}),
			),
			binding(
				"analyticsConfig",
				text("umamiAnalytics.shareId", "Umami 分享链接 Slug", {
					maxLength: 80,
					help: "仅用于读取公开统计，不要填写管理员 Token",
				}),
			),
			binding(
				"analyticsConfig",
				url("umamiAnalytics.shareApiBase", "Umami 统计 API 地址", {
					urlPrefixes: ["http://", "https://"],
				}),
			),
			binding(
				"analyticsConfig",
				number("umamiAnalytics.historicalStats.visitors", "历史访客数", {
					min: 0,
					max: 100000000,
				}),
			),
			binding(
				"analyticsConfig",
				number("umamiAnalytics.historicalStats.pageviews", "历史浏览量", {
					min: 0,
					max: 100000000,
				}),
			),
			binding(
				"analyticsConfig",
				boolean("umamiAnalytics.showPageViews", "显示文章阅读量"),
			),
			binding(
				"analyticsConfig",
				boolean("umamiAnalytics.showSiteStats", "显示站点统计卡片"),
			),
			binding(
				"analyticsConfig",
				text("la51Analytics.Id", "51la 统计 ID", { maxLength: 80 }),
			),
		],
	},
	{
		key: "license",
		label: "版权许可",
		section: "settings",
		description: "文章顶部显示的许可证信息。",
		filePath: "src/config/licenseConfig.ts",
		fields: [
			binding("licenseConfig", boolean("enable", "显示许可证信息")),
			binding(
				"licenseConfig",
				text("name", "许可证名称", { required: true, maxLength: 80 }),
			),
			binding(
				"licenseConfig",
				url("url", "许可证链接", { urlPrefixes: ["http://", "https://"] }),
			),
		],
	},
	{
		key: "footer",
		label: "页脚",
		section: "settings",
		description: "页脚注入开关与自定义 HTML（备案号等）。",
		filePath: "src/config/footerConfig.ts",
		fields: [binding("footerConfig", boolean("enable", "启用页脚 HTML 注入"))],
		codeFiles: [
			{
				id: "footer.html",
				path: "src/config/FooterConfig.html",
				label: "自定义页脚 HTML",
				help: "完整替换 FooterConfig.html 文件内容",
				maxLength: 20000,
			},
		],
	},
];

export const getConfigGroup = (key: string): ConfigGroup | null =>
	CONFIG_GROUPS.find((group) => group.key === key) ?? null;

export const groupFieldIds = (group: ConfigGroup): string[] => [
	...group.fields.map((field) => field.id),
];

// ---------------------------------------------------------------------------
// 解析与补丁
// ---------------------------------------------------------------------------

// 从配置文件文本读取注册表声明的全部字段值。
// 标识符引用（如 SITE_LANG）按 $ref 原样返回，前端以只读方式呈现。
export const parseGroupValues = (
	source: string,
	group: ConfigGroup,
): Record<string, JsonLikeValue> => {
	const values: Record<string, JsonLikeValue> = {};
	for (const field of group.fields) {
		const node = findConstNode(source, field.block, field.path);
		values[field.id] = node ? finalizeNode(node) : null;
	}
	return values;
};

const stripUndefined = (value: JsonLikeValue): JsonLikeValue => {
	if (Array.isArray(value)) return value.map(stripUndefined);
	if (typeof value === "object" && value !== null) {
		const result: { [key: string]: JsonLikeValue } = {};
		for (const [key, item] of Object.entries(value)) {
			if (item === undefined) continue;
			result[key] = stripUndefined(item);
		}
		return result;
	}
	return value;
};

// 校验提交的分组字段值，返回 fieldId -> 错误信息。
export const validateGroupValues = (
	group: ConfigGroup,
	values: Record<string, JsonLikeValue>,
	code?: Record<string, string>,
): Record<string, string> => {
	const errors: Record<string, string> = {};
	const checkField = (field: FieldMeta, value: JsonLikeValue, id: string) => {
		if (isLiteralRef(value)) return;
		switch (field.type) {
			case "text":
			case "textarea":
			case "color": {
				if (typeof value !== "string") {
					errors[id] = "必须为文本";
					return;
				}
				if (field.required && value.trim().length === 0) {
					errors[id] = "必填项";
					return;
				}
				const limit = field.maxLength ?? 200;
				if (value.length > limit) {
					errors[id] = "长度不能超过 " + String(limit) + " 个字符";
					return;
				}
				if (containsSensitiveValue(value)) errors[id] = "包含疑似密钥内容";
				return;
			}
			case "url":
			case "image": {
				if (typeof value !== "string") {
					errors[id] = "必须为文本";
					return;
				}
				if (field.required && value.trim().length === 0) {
					errors[id] = "必填项";
					return;
				}
				if (value.length === 0) return;
				const prefixes = field.urlPrefixes ?? standardUrlPrefixes;
				const matched = prefixes.some((prefix) => value.startsWith(prefix));
				if (!matched) {
					errors[id] = "必须以 " + prefixes.join("、") + " 开头";
					return;
				}
				if (value.length > 500) errors[id] = "长度不能超过 500 个字符";
				if (value.includes(" ") || value.includes('"'))
					errors[id] = "包含非法字符";
				if (containsSensitiveValue(value)) errors[id] = "包含疑似密钥内容";
				return;
			}
			case "number": {
				if (typeof value !== "number" || !Number.isFinite(value)) {
					errors[id] = "必须为数字";
					return;
				}
				if (field.integer && !Number.isInteger(value)) {
					errors[id] = "必须为整数";
					return;
				}
				if (field.min !== undefined && value < field.min)
					errors[id] = "不能小于 " + String(field.min);
				if (field.max !== undefined && value > field.max)
					errors[id] = "不能大于 " + String(field.max);
				return;
			}
			case "boolean": {
				if (typeof value !== "boolean") errors[id] = "必须为布尔值";
				return;
			}
			case "select": {
				if (
					typeof value !== "string" ||
					!field.options.some((o) => o.value === value)
				)
					errors[id] = "选项无效";
				return;
			}
			case "tags": {
				if (!Array.isArray(value)) {
					errors[id] = "必须为字符串数组";
					return;
				}
				if (value.length > (field.maxItems ?? 20)) {
					errors[id] = "最多 " + String(field.maxItems ?? 20) + " 项";
					return;
				}
				for (const item of value) {
					if (
						typeof item !== "string" ||
						item.length === 0 ||
						item.length > 60
					) {
						errors[id] = "每项必须为 1-60 个字符的文本";
						return;
					}
				}
				return;
			}
			case "list": {
				if (!Array.isArray(value)) {
					errors[id] = "必须为列表";
					return;
				}
				if (value.length > (field.maxItems ?? 100)) {
					errors[id] = "最多 " + String(field.maxItems ?? 100) + " 项";
					return;
				}
				value.forEach((item, index) => {
					if (
						typeof item !== "object" ||
						item === null ||
						Array.isArray(item)
					) {
						errors[id] = "第 " + String(index + 1) + " 项格式无效";
						return;
					}
					const itemId = id + "[" + String(index) + "]";
					for (const itemField of field.fields) {
						const itemValue = (item as Record<string, JsonLikeValue>)[
							itemField.key
						];
						if (itemValue === undefined) {
							if (itemField.type === "text" && itemField.required)
								errors[itemId + "." + itemField.key] = "必填项";
							continue;
						}
						checkField(itemField, itemValue, itemId + "." + itemField.key);
					}
				});
				return;
			}
		}
	};
	for (const field of group.fields) {
		const value = values[field.id];
		if (value === undefined) {
			errors[field.id] = "缺少字段";
			continue;
		}
		checkField(field.field, value, field.id);
	}
	if (code) {
		for (const codeFile of group.codeFiles ?? []) {
			const content = code[codeFile.id];
			if (typeof content !== "string") {
				errors[codeFile.id] = "缺少文件内容";
				continue;
			}
			if (content.length > codeFile.maxLength) {
				errors[codeFile.id] =
					"内容不能超过 " + String(codeFile.maxLength) + " 个字符";
			}
			if (containsSensitiveValue(content))
				errors[codeFile.id] = "包含疑似密钥内容";
		}
	}
	return errors;
};

export type GroupPatchResult = {
	content: string | null; // null 表示无变化
	changed: string[];
};

// 把提交值补丁进配置文件文本；标识符引用字段跳过；无变化的路径不触碰文件。
export const applyGroupValues = (
	source: string,
	group: ConfigGroup,
	values: Record<string, JsonLikeValue>,
): GroupPatchResult => {
	let content = source;
	const changed: string[] = [];
	for (const field of group.fields) {
		const target = values[field.id];
		if (target === undefined || isLiteralRef(target)) continue;
		const node = findConstNode(source, field.block, field.path);
		if (!node) continue; // 结构缺失时由 parse 阶段暴露，不在补丁里新增结构
		const current = finalizeNode(node);
		if (literalEquals(current, target)) continue;
		content = patchConstValue(
			content,
			field.block,
			field.path,
			stripUndefined(target),
		);
		changed.push(field.id);
	}
	return { content: changed.length > 0 ? content : null, changed };
};

export type { JsonLikeValue };
