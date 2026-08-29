import assert from "node:assert/strict";
import test from "node:test";
import {
	literalEquals,
	parseConst,
	patchConstValue,
	stringifyLiteral,
} from "../../functions/api/admin/_shared/config/json-like";

const sample = `import type { Demo } from "../types/demo";

export const demoConfig: Demo = {
	// 标题
	title: "Nevino",
	count: 12,
	enabled: true,
	nested: {
		// 嵌套注释保留
		url: "/about/",
		tags: ["a", "b"],
	},
	empty: [],
};

export const items: string[] = [
	// 项目注释
	"one",
	"two",
];

const helper = (): number => 1;
`;

test("parseConst 读取对象与数组字面量", () => {
	const config = parseConst(sample, "demoConfig").value;
	assert.equal(config.title, "Nevino");
	assert.equal(config.count, 12);
	assert.equal(config.enabled, true);
	assert.deepEqual(config.nested.tags, ["a", "b"]);
	assert.deepEqual(config.empty, []);
	assert.deepEqual(parseConst(sample, "items").value, ["one", "two"]);
});

test("补丁只替换目标路径并保留其余内容", () => {
	const patched = patchConstValue(sample, "demoConfig", ["title"], "新标题");
	assert.ok(patched.includes("title: \"新标题\""));
	// 注释与无关结构必须原样保留
	assert.ok(patched.includes("// 标题"));
	assert.ok(patched.includes("// 嵌套注释保留"));
	assert.ok(patched.includes("const helper = (): number => 1;"));
	assert.ok(patched.includes("count: 12,"));
});

test("补丁嵌套路径与整个数组", () => {
	const patchedUrl = patchConstValue(sample, "demoConfig", ["nested", "url"], "/tools/");
	assert.ok(patchedUrl.includes("url: \"/tools/\""));
	const patchedItems = patchConstValue(sample, "items", [], ["x", "y", "z"]);
	assert.ok(patchedItems.includes("\"x\","));
	const reparsed = parseConst(patchedItems, "items").value;
	assert.deepEqual(reparsed, ["x", "y", "z"]);
});

test("解析后的值与新值深度相等时不产生结构差异", () => {
	const value = parseConst(sample, "demoConfig").value;
	assert.ok(literalEquals(value.title, "Nevino"));
	assert.ok(literalEquals(value.nested.tags, ["a", "b"]));
	assert.ok(!literalEquals(value.title, "其他"));
});

test("序列化输出可再次解析（往返一致）", () => {
	const value = {
		title: "引号\"内的\"文本",
		multiline: "第一行\n第二行",
		list: [1, 2, 3],
		flag: false,
		none: null,
	};
	const serialized = stringifyLiteral(value, "\t");
	const source = "const roundtrip = " + serialized + ";";
	assert.deepEqual(parseConst(source, "roundtrip").value, value);
});

test("标识符引用按 $ref 呈现且不可序列化", () => {
	const source = "const lang = SITE_LANG; const config = { lang: SITE_LANG };";
	const value = parseConst(source, "config").value;
	assert.deepEqual(value.lang, { $ref: "SITE_LANG" });
});

test("结构缺失路径抛出错误而不是隐式新增", () => {
	assert.throws(
		() => patchConstValue(sample, "demoConfig", ["missing", "path"], 1),
		/配置结构缺少路径/,
	);
});

test("转义字符串被正确解析", () => {
	const source = 'const config = { text: "第一\\n第二\\"引用" };';
	const value = parseConst(source, "config").value;
	assert.equal(value.text, "第一\n第二\"引用");
});
