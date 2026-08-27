import assert from "node:assert/strict";
import test from "node:test";
import {
	parseMarkdownDocument,
	parsePostMarkdown,
	toMarkdown,
} from "../../functions/api/admin/_shared/markdown";

const markdown = `---
title: "Hello: Firefly"
published: 2026-08-27
draft: false
description: "line one"
aiSummary: "summary"
image: "/cover.webp"
tags: [Astro, Svelte]
category: "Tech"
lang: "zh-CN"
pinned: true
author: "Author"
sourceLink: "https://example.com"
licenseName: "CC BY 4.0"
licenseUrl: "https://example.com/license"
comment: false
---

# Body
`;

test("解析受支持 frontmatter 和正文", () => {
	assert.deepEqual(parseMarkdownDocument(markdown, "hello-firefly"), {
		slug: "hello-firefly",
		title: "Hello: Firefly",
		published: "2026-08-27",
		description: "line one",
		aiSummary: "summary",
		image: "/cover.webp",
		tags: ["Astro", "Svelte"],
		category: "Tech",
		lang: "zh-CN",
		pinned: true,
		author: "Author",
		sourceLink: "https://example.com",
		licenseName: "CC BY 4.0",
		licenseUrl: "https://example.com/license",
		comment: false,
		content: "# Body\n",
	});
});

test("parsePostMarkdown 保持兼容并且序列化后再次解析字段一致", () => {
	const parsed = parsePostMarkdown(markdown, "hello-firefly");
	assert.deepEqual(
		parseMarkdownDocument(toMarkdown(parsed, true), "hello-firefly"),
		parsed,
	);
});

test("拒绝 MDX、HTML、密码字段、未知字段、重复键和 YAML alias", () => {
	for (const value of [
		"---\ntitle: A\npublished: 2026-08-27\npassword: secret\n---\nBody",
		"---\ntitle: A\npublished: 2026-08-27\nlayout: ../../x\n---\nBody",
		"---\ntitle: &title A\npublished: 2026-08-27\ndescription: *title\n---\nBody",
		"---\ntitle: A\npublished: 2026-08-27\ntitle: B\n---\nBody",
		"---\ntitle: A\npublished: 2026-08-27\n---\nimport X from './x'",
		"---\ntitle: A\npublished: 2026-08-27\n---\n<div>unsafe</div>",
		"---\ntitle: A\npublished: 2026-08-27\npasswordHint: hint\n---\nBody",
	])
		assert.throws(() => parseMarkdownDocument(value, "safe-slug"));
});

test("拒绝非法路径 slug、缺失标题、无效日期和 frontmatter 类型", () => {
	assert.throws(() => parseMarkdownDocument(markdown, "../escape"));
	assert.throws(() =>
		parseMarkdownDocument("---\npublished: 2026-08-27\n---\nBody", "safe"),
	);
	assert.throws(() =>
		parseMarkdownDocument(
			"---\ntitle: A\npublished: tomorrow\n---\nBody",
			"safe",
		),
	);
	assert.throws(() =>
		parseMarkdownDocument(
			"---\ntitle: A\npublished: 2026-08-27\ntags: nope\n---\nBody",
			"safe",
		),
	);
});
