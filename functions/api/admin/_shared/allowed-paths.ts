// 后台可写入 GitHub 的全部路径白名单。
// 文章遵循 slug 目录模式；独立页面与配置文件只放行精确路径，
// 新增可管理内容时必须在这里登记，避免开放任意仓库路径。

const postsPattern =
	/^src\/content\/posts\/[a-z0-9]+(?:-[a-z0-9]+)*\/index\.md$/;

export const SPEC_PAGE_PATHS = [
	"src/content/spec/about.md",
	"src/content/spec/guestbook.md",
	"src/content/spec/friends.mdx",
] as const;

export const CONFIG_FILE_PATHS = [
	"src/config/siteConfig.ts",
	"src/config/profileConfig.ts",
	"src/config/friendsConfig.ts",
	"src/config/galleryConfig.ts",
	"src/config/announcementConfig.ts",
	"src/config/sponsorConfig.ts",
	"src/config/commentConfig.ts",
	"src/config/analyticsConfig.ts",
	"src/config/licenseConfig.ts",
	"src/config/footerConfig.ts",
	"src/config/FooterConfig.html",
	"src/config/toolsConfig.ts",
] as const;

const allowedExactPaths = new Set<string>([
	...SPEC_PAGE_PATHS,
	...CONFIG_FILE_PATHS,
]);

export const isAllowedGitHubPath = (path: string): boolean =>
	postsPattern.test(path) || allowedExactPaths.has(path);
