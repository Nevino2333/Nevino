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

export type FieldMeta = FieldBase &
	(
		| {
				type: "text" | "textarea" | "url" | "image" | "color";
				required?: boolean;
				maxLength?: number;
				placeholder?: string;
				urlPrefixes?: string[];
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
): FieldBinding => {
	// 块本身是数组（如 friendsConfig）时 path 为空；否则 key 是块内成员名
	const path = key === block ? [] : [key];
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
	options?: { required?: boolean; maxLength?: number; help?: string; placeholder?: string },
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
	options?: { required?: boolean; urlPrefixes?: string[]; help?: string },
): FieldMeta => ({
	key,
	type: "url",
	label,
	required: options?.required,
	maxLength: 500,
	urlPrefixes: options?.urlPrefixes,
	help: options?.help,
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
	url("siteurl", "站点地址", { required: true, urlPrefixes: standardUrlPrefixes }),
	url("imgurl", "头像地址", { required: true, urlPrefixes: standardUrlPrefixes }),
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
			binding("friendsPageConfig", text("title", "页面标题", { maxLength: 120 })),
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
			binding("announcementConfig", text("title", "公告标题", { maxLength: 120 })),
			binding(
				"announcementConfig",
				textarea("content", "公告内容", { maxLength: 1000 }),
			),
			binding("announcementConfig", boolean("closable", "允许访客关闭公告")),
			binding("announcementConfig", boolean("link.enable", "启用链接")),
			binding("announcementConfig", text("link.text", "链接文本", { maxLength: 60 })),
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
			binding("sponsorConfig", boolean("showButtonInPost", "文章页显示打赏按钮")),
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
		key: "site",
		label: "站点信息",
		section: "settings",
		description: "站点标题、描述、页面开关与文章列表布局等核心设置。",
		filePath: "src/config/siteConfig.ts",
		fields: [
			binding("siteConfig", text("title", "站点标题", { required: true, maxLength: 100 })),
			binding("siteConfig", text("subtitle", "站点副标题", { maxLength: 200 })),
			binding(
				"siteConfig",
				textarea("description", "站点描述", { maxLength: 400 }),
			),
			binding("siteConfig", tags("keywords", "站点关键词")),
			binding(
				"siteConfig",
				url("site_url", "站点 URL", { required: true, urlPrefixes: ["http://", "https://"] }),
			),
			binding("siteConfig", text("timezone", "时区（IANA）", { maxLength: 64 })),
			binding("siteConfig", text("siteStartDate", "建站日期（YYYY-MM-DD）", { maxLength: 10 })),
			binding("siteConfig", number("themeColor.hue", "主题色色相", { min: 0, max: 360 })),
			binding("siteConfig", boolean("themeColor.fixed", "隐藏主题色选择器")),
			binding(
				"siteConfig",
				select("themeColor.defaultMode", "默认外观模式", [
					{ value: "light", label: "亮色" },
					{ value: "dark", label: "暗色" },
					{ value: "system", label: "跟随系统" },
				]),
			),
			binding("siteConfig", text("navbar.title", "导航栏标题", { maxLength: 100 })),
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
				number("postListLayout.descriptionLines", "摘要行数", { min: 0, max: 10 }),
			),
			binding("siteConfig", boolean("postListLayout.grid.masonry", "瀑布流布局")),
			binding(
				"siteConfig",
				number("postListLayout.grid.columnWidth", "网格最小列宽(px)", { min: 200, max: 800 }),
			),
			binding("siteConfig", boolean("post.showLastModified", "显示上次编辑时间")),
			binding(
				"siteConfig",
				number("post.outdatedThreshold", "过期提示阈值（天）", { min: 0, max: 3650 }),
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
			binding("profileConfig", text("name", "名字", { required: true, maxLength: 80 })),
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
				url("twikoo.envId", "Twikoo 环境地址", { urlPrefixes: ["http://", "https://"] }),
			),
			binding(
				"commentConfig",
				url("artalk.server", "Artalk 服务地址", { urlPrefixes: ["http://", "https://"] }),
			),
			binding("commentConfig", text("disqus.shortname", "Disqus Shortname", { maxLength: 120 })),
			binding("commentConfig", text("giscus.repo", "Giscus 仓库", { maxLength: 160 })),
			binding("commentConfig", text("giscus.repoId", "Giscus 仓库 ID", { maxLength: 80 })),
			binding("commentConfig", text("giscus.category", "Giscus 分类", { maxLength: 80 })),
			binding("commentConfig", text("giscus.categoryId", "Giscus 分类 ID", { maxLength: 80 })),
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
		],
	},
	{
		key: "analytics",
		label: "访问统计",
		section: "settings",
		description: "统计服务 ID 与站点统计卡片的展示开关。",
		filePath: "src/config/analyticsConfig.ts",
		fields: [
			binding("analyticsConfig", text("googleAnalyticsId", "Google Analytics ID", { maxLength: 60 })),
			binding("analyticsConfig", text("microsoftClarityId", "Microsoft Clarity ID", { maxLength: 60 })),
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
				number("umamiAnalytics.historicalStats.visitors", "历史访客数", { min: 0, max: 100000000 }),
			),
			binding(
				"analyticsConfig",
				number("umamiAnalytics.historicalStats.pageviews", "历史浏览量", { min: 0, max: 100000000 }),
			),
			binding("analyticsConfig", boolean("umamiAnalytics.showPageViews", "显示文章阅读量")),
			binding("analyticsConfig", boolean("umamiAnalytics.showSiteStats", "显示站点统计卡片")),
			binding("analyticsConfig", text("la51Analytics.Id", "51la 统计 ID", { maxLength: 80 })),
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
			binding("licenseConfig", text("name", "许可证名称", { required: true, maxLength: 80 })),
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
				if (value.includes(" ") || value.includes('"')) errors[id] = "包含非法字符";
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
				if (typeof value !== "string" || !field.options.some((o) => o.value === value))
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
					if (typeof item !== "string" || item.length === 0 || item.length > 60) {
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
					if (typeof item !== "object" || item === null || Array.isArray(item)) {
						errors[id] = "第 " + String(index + 1) + " 项格式无效";
						return;
					}
					const itemId = id + "[" + String(index) + "]";
					for (const itemField of field.fields) {
						const itemValue = (item as Record<string, JsonLikeValue>)[itemField.key];
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
			if (containsSensitiveValue(content)) errors[codeFile.id] = "包含疑似密钥内容";
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
