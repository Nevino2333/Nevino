import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
	CONFIG_FILE_PATHS,
	SPEC_PAGE_PATHS,
} from "../../functions/api/admin/_shared/allowed-paths";
import {
	applyGroupValues,
	CONFIG_GROUPS,
	parseGroupValues,
	validateGroupValues,
} from "../../functions/api/admin/_shared/config/registry";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const readRepoFile = (relativePath: string): string =>
	fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

test("注册表里的每个配置文件都在 GitHub 白名单内", () => {
	const allowed = new Set<string>(CONFIG_FILE_PATHS);
	for (const group of CONFIG_GROUPS) {
		assert.ok(
			allowed.has(group.filePath),
			"白名单缺少 " + group.filePath,
		);
		for (const codeFile of group.codeFiles ?? [])
			assert.ok(allowed.has(codeFile.path), "白名单缺少 " + codeFile.path);
	}
});

test("页面注册表与白名单一致", () => {
	const allowed = new Set<string>(SPEC_PAGE_PATHS);
	assert.equal(allowed.size, SPEC_PAGE_PATHS.length);
});

test("真实配置文件可解析出全部声明字段", () => {
	for (const group of CONFIG_GROUPS) {
		const source = readRepoFile(group.filePath);
		const values = parseGroupValues(source, group);
		for (const field of group.fields) {
			assert.ok(
				field.id in values,
				group.key + " 缺少字段 " + field.id,
			);
			assert.notEqual(
				values[field.id] === undefined,
				true,
				field.id + " 解析结果异常",
			);
		}
	}
});

test("用解析值原样补丁不产生任何文件变更（幂等）", () => {
	for (const group of CONFIG_GROUPS) {
		const source = readRepoFile(group.filePath);
		const values = parseGroupValues(source, group);
		const result = applyGroupValues(source, group, values);
		assert.equal(
			result.content,
			null,
			group.key + " 原样补丁不应产生变更: " + result.changed.join(","),
		);
	}
});

test("修改字段值后补丁可重新解析出目标值", () => {
	const group = CONFIG_GROUPS.find((item) => item.key === "announcement");
	assert.ok(group);
	const source = readRepoFile(group.filePath);
	const values = parseGroupValues(source, group);
	const titleId = "announcementConfig.title";
	const contentId = "announcementConfig.content";
	const next = {
		...values,
		[titleId]: "后台修改的标题",
		[contentId]: "后台修改的内容",
	};
	const result = applyGroupValues(source, group, next);
	assert.ok(result.content);
	assert.deepEqual(result.changed, [titleId, contentId]);
	const reparsed = parseGroupValues(result.content, group);
	assert.equal(reparsed[titleId], "后台修改的标题");
	assert.equal(reparsed[contentId], "后台修改的内容");
	// 未修改字段保持原值
	assert.equal(reparsed["announcementConfig.closable"], true);
});

test("列表字段增删项可以补丁并重新解析", () => {
	const group = CONFIG_GROUPS.find((item) => item.key === "friends");
	assert.ok(group);
	const source = readRepoFile(group.filePath);
	const values = parseGroupValues(source, group);
	const listId = "friendsConfig";
	const original = values[listId];
	assert.ok(Array.isArray(original));
	const next = {
		...values,
		[listId]: [
			{
				title: "示例友链",
				desc: "描述",
				siteurl: "https://example.com",
				imgurl: "https://example.com/avatar.png",
				rss: "https://example.com/rss.xml",
				tags: ["测试"],
				recommended: false,
				temporarilyUnavailable: false,
				weight: 10,
				enabled: true,
			},
		],
	};
	const result = applyGroupValues(source, group, next);
	assert.ok(result.content);
	const reparsed = parseGroupValues(result.content, group);
	const items = reparsed[listId];
	assert.ok(Array.isArray(items) && items.length === 1);
	assert.equal(items[0].title, "示例友链");
	assert.equal(items[0].weight, 10);
	// 帮助函数与页面配置不被破坏
	assert.ok(result.content.includes("getEnabledFriends"));
	assert.equal(
		reparsed["friendsPageConfig.showComment"],
		parseGroupValues(source, group)["friendsPageConfig.showComment"],
	);
});

test("嵌套音乐播放列表的歌曲字段可以补丁并重新解析", () => {
	const group = CONFIG_GROUPS.find((item) => item.key === "music");
	assert.ok(group);
	const source = readRepoFile(group.filePath);
	const values = parseGroupValues(source, group);
	const listId = "musicPlayerConfig.local.playlist";
	const playlist = values[listId];
	assert.ok(Array.isArray(playlist) && playlist.length > 0);
	const firstSong = { ...(playlist[0] as Record<string, unknown>), name: "后台改名歌曲" };
	const result = applyGroupValues(source, group, {
		...values,
		[listId]: [firstSong],
	});
	assert.ok(result.content);
	assert.deepEqual(result.changed, [listId]);
	const reparsed = parseGroupValues(result.content, group);
	const updated = reparsed[listId];
	assert.ok(Array.isArray(updated) && updated.length === 1);
	assert.equal((updated[0] as Record<string, unknown>).name, "后台改名歌曲");
	assert.equal((updated[0] as Record<string, unknown>).url, (playlist[0] as Record<string, unknown>).url);
});

test("校验器拒绝非法值并接受合法值", () => {
	const group = CONFIG_GROUPS.find((item) => item.key === "site");
	assert.ok(group);
	const source = readRepoFile(group.filePath);
	const values = parseGroupValues(source, group);
	assert.deepEqual(validateGroupValues(group, values), {});
	const bad = {
		...values,
		"siteConfig.title": "",
		"siteConfig.themeColor.hue": 999,
		"siteConfig.pages.friends": "yes",
		"siteConfig.keywords": [42],
		"siteConfig.site_url": "ftp://example.com",
	};
	const errors = validateGroupValues(group, bad);
	for (const id of [
		"siteConfig.title",
		"siteConfig.themeColor.hue",
		"siteConfig.pages.friends",
		"siteConfig.keywords",
		"siteConfig.site_url",
	])
		assert.ok(errors[id], "应拒绝 " + id);
});

test("疑似密钥内容被拒绝", () => {
	const group = CONFIG_GROUPS.find((item) => item.key === "announcement");
	assert.ok(group);
	const values = parseGroupValues(
		readRepoFile(group.filePath),
		group,
	);
	const bad = {
		...values,
		"announcementConfig.content": "我的 token 是 ghp_abc123 不要外传",
	};
	const errors = validateGroupValues(group, bad);
	assert.ok(errors["announcementConfig.content"]);
});
