// TS 配置文件里"纯数据字面量"的解析与原位补丁。
// 设计约束：只处理数据（对象/数组/字符串/数字/布尔/null/注释/未加引号的键/尾逗号），
// 不求值、不执行任何代码；补丁只替换目标路径的字面量片段，文件其余内容逐字保留，
// 保证注释、类型标注和手工排版不会被后台发布破坏。
// 实现说明：只使用静态正则与显式 switch，不构造动态正则，不做动态求值。

export type JsonLikeValue =
	| string
	| number
	| boolean
	| null
	| JsonLikeValue[]
	| { [key: string]: JsonLikeValue };

// 标识符引用（例如 lang: SITE_LANG），序列化不支持，由调用方决定如何呈现。
export type LiteralRef = { readonly $ref: string };

export const isLiteralRef = (value: unknown): value is LiteralRef =>
	typeof value === "object" &&
	value !== null &&
	"$ref" in value &&
	typeof (value as { $ref: unknown }).$ref === "string";

export type LiteralNode = {
	start: number;
	end: number;
	value: JsonLikeValue;
	members?: Map<string, LiteralNode>;
	items?: LiteralNode[];
};

export class LiteralParseError extends Error {
	code: string = "config_parse_failed";
}

const skipTrivia = (source: string, index: number): number => {
	let cursor = index;
	for (;;) {
		while (cursor < source.length && /\s/.test(source[cursor] ?? "")) cursor += 1;
		if (source.startsWith("//", cursor)) {
			const newline = source.indexOf("\n", cursor);
			cursor = newline === -1 ? source.length : newline + 1;
			continue;
		}
		if (source.startsWith("/*", cursor)) {
			const close = source.indexOf("*/", cursor + 2);
			if (close === -1) throw new LiteralParseError("未闭合的块注释");
			cursor = close + 2;
			continue;
		}
		return cursor;
	}
};

const isIdentifierStart = (character: string): boolean =>
	/[A-Za-z_$]/.test(character);

const isIdentifierPart = (character: string): boolean =>
	/[A-Za-z0-9_$]/.test(character);

const escapeCharacter = (next: string): string => {
	switch (next) {
		case "n":
			return "\n";
		case "t":
			return "\t";
		case "r":
			return "\r";
		case "b":
			return "\b";
		case "f":
			return "\f";
		case "v":
			return "\v";
		case "0":
			return "\0";
		case "u":
			throw new LiteralParseError("不支持 \\u 转义，请直接写字符");
		default:
			return next;
	}
};

const readString = (
	source: string,
	index: number,
): { value: string; end: number } => {
	const quote = source[index];
	let result = "";
	let cursor = index + 1;
	while (cursor < source.length) {
		const character = source[cursor];
		if (character === "\\") {
			const next = source[cursor + 1];
			if (next === undefined) throw new LiteralParseError("字符串转义不完整");
			result = result + escapeCharacter(next);
			cursor += 2;
			continue;
		}
		if (character === quote) return { value: result, end: cursor + 1 };
		result = result + character;
		cursor += 1;
	}
	throw new LiteralParseError("字符串未闭合");
};

const numberPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;

const readNumber = (
	source: string,
	index: number,
): { value: number; end: number } => {
	const match = source.slice(index).match(numberPattern);
	if (!match) throw new LiteralParseError("无效的数字");
	return { value: Number(match[0]), end: index + match[0].length };
};

const readIdentifier = (
	source: string,
	index: number,
): { value: string; end: number } => {
	const first = source[index];
	if (!first || !isIdentifierStart(first))
		throw new LiteralParseError("无效的标识符");
	let cursor = index + 1;
	while (cursor < source.length && isIdentifierPart(source[cursor] ?? ""))
		cursor += 1;
	return { value: source.slice(index, cursor), end: cursor };
};

// 允许值之后紧跟 `as const` 断言尾巴（span 不含尾巴，补丁可安全替换值本身）
const skipAsConst = (source: string, index: number): number => {
	const afterAs = skipTrivia(source, index);
	if (!source.startsWith("as", afterAs)) return index;
	const afterAsKeyword = skipTrivia(source, afterAs + 2);
	if (!source.startsWith("const", afterAsKeyword)) return index;
	return skipTrivia(source, afterAsKeyword + 5);
};

const parseNode = (
	source: string,
	index: number,
): { node: LiteralNode; next: number } => {
	const start = skipTrivia(source, index);
	const character = source[start];
	if (character === "{") {
		const members = new Map<string, LiteralNode>();
		let cursor = skipTrivia(source, start + 1);
		if (source[cursor] === "}")
			return {
				node: { start, end: cursor + 1, value: {}, members },
				next: cursor + 1,
			};
		for (;;) {
			cursor = skipTrivia(source, cursor);
			// 支持尾逗号：逗号后允许直接收尾
			if (source[cursor] === "}")
				return {
					node: { start, end: cursor + 1, value: {}, members },
					next: cursor + 1,
				};
			const keyCharacter = source[cursor];
			let key: string;
			if (keyCharacter === '"' || keyCharacter === "'") {
				const read = readString(source, cursor);
				key = read.value;
				cursor = read.end;
			} else {
				const read = readIdentifier(source, cursor);
				key = read.value;
				cursor = read.end;
			}
			cursor = skipTrivia(source, cursor);
			if (source[cursor] !== ":") throw new LiteralParseError("对象缺少冒号");
			const parsed = parseNode(source, cursor + 1);
			members.set(key, parsed.node);
			cursor = skipTrivia(source, skipAsConst(source, parsed.next));
			if (source[cursor] === ",") {
				cursor += 1;
				continue;
			}
			if (source[cursor] === "}")
				return {
					node: { start, end: cursor + 1, value: {}, members },
					next: cursor + 1,
				};
			throw new LiteralParseError("对象缺少收尾括号");
		}
	}
	if (character === "[") {
		const items: LiteralNode[] = [];
		let cursor = skipTrivia(source, start + 1);
		if (source[cursor] === "]")
			return {
				node: { start, end: cursor + 1, value: [], items },
				next: cursor + 1,
			};
		for (;;) {
			const parsed = parseNode(source, cursor);
			items.push(parsed.node);
			cursor = skipTrivia(source, skipAsConst(source, parsed.next));
			if (source[cursor] === ",") {
				cursor += 1;
				cursor = skipTrivia(source, cursor);
				if (source[cursor] === "]")
					return {
						node: { start, end: cursor + 1, value: [], items },
						next: cursor + 1,
					};
				continue;
			}
			if (source[cursor] === "]")
				return {
					node: { start, end: cursor + 1, value: [], items },
					next: cursor + 1,
				};
			throw new LiteralParseError("数组缺少收尾括号");
		}
	}
	if (character === '"' || character === "'") {
		const read = readString(source, start);
		return { node: { start, end: read.end, value: read.value }, next: read.end };
	}
	if (character === "`") {
		const close = source.indexOf("`", start + 1);
		if (close === -1) throw new LiteralParseError("模板字符串未闭合");
		const raw = source.slice(start + 1, close);
		if (raw.includes("${")) throw new LiteralParseError("不支持含插值的模板字符串");
		return { node: { start, end: close + 1, value: raw }, next: close + 1 };
	}
	if (/[0-9-]/.test(character ?? "")) {
		const read = readNumber(source, start);
		return { node: { start, end: read.end, value: read.value }, next: read.end };
	}
	const identifier = readIdentifier(source, start);
	if (identifier.value === "true" || identifier.value === "false")
		return {
			node: { start, end: identifier.end, value: identifier.value === "true" },
			next: identifier.end,
		};
	if (identifier.value === "null" || identifier.value === "undefined")
		return {
			node: { start, end: identifier.end, value: null },
			next: identifier.end,
		};
	return {
		node: { start, end: identifier.end, value: { $ref: identifier.value } },
		next: identifier.end,
	};
};

// 把节点树转成纯数据：数组/对象节点的 value 字段是占位，必须经此归一化。
export const finalizeNode = (node: LiteralNode): JsonLikeValue => {
	if (node.members) {
		const result: { [key: string]: JsonLikeValue } = {};
		for (const [key, child] of node.members) result[key] = finalizeNode(child);
		return result;
	}
	if (node.items) return node.items.map(finalizeNode);
	return node.value;
};

const DECLARATION_KEYWORDS = ["const", "let", "var"] as const;

// 手写扫描定位 `(export )? const NAME` 声明起点，不构造动态正则。
const findConstDeclaration = (source: string, constName: string): number => {
	let cursor = 0;
	while (cursor <= source.length - constName.length) {
		let earliest = -1;
		for (const keyword of DECLARATION_KEYWORDS) {
			const found = source.indexOf(keyword, cursor);
			if (found !== -1 && (earliest === -1 || found < earliest)) earliest = found;
		}
		if (earliest === -1) break;
		let probe = skipTrivia(source, earliest);
		let matchedKeyword = "";
		for (const keyword of DECLARATION_KEYWORDS) {
			if (source.startsWith(keyword, probe)) {
				matchedKeyword = keyword;
				break;
			}
		}
		if (!matchedKeyword) {
			cursor = earliest + 1;
			continue;
		}
		probe = skipTrivia(source, probe + matchedKeyword.length);
		if (!isIdentifierStart(source[probe] ?? "")) {
			cursor = earliest + 1;
			continue;
		}
		const name = readIdentifier(source, probe);
		if (name.value === constName) return earliest;
		cursor = earliest + 1;
	}
	throw new LiteralParseError("配置文件中找不到该配置声明");
};

export type ParsedConst = {
	node: LiteralNode;
	value: JsonLikeValue;
};

// 定位 `export const NAME[: Type] = <literal>` 并解析字面量（含子节点 span）。
export const parseConst = (source: string, constName: string): ParsedConst => {
	const declaration = findConstDeclaration(source, constName);
	let probe = skipTrivia(source, declaration);
	let matchedKeyword = "";
	for (const keyword of DECLARATION_KEYWORDS) {
		if (source.startsWith(keyword, probe)) {
			matchedKeyword = keyword;
			break;
		}
	}
	if (matchedKeyword) probe = skipTrivia(source, probe + matchedKeyword.length);
	const nameRead = readIdentifier(source, probe);
	if (nameRead.value !== constName) throw new LiteralParseError("配置声明解析失败");
	let cursor = skipTrivia(source, nameRead.end);
	// 跳过类型标注（: Type），类型标注中不允许出现等号
	if (source[cursor] === ":") {
		while (cursor < source.length && source[cursor] !== "=") {
			if (source[cursor] === ";" || source[cursor] === "\n") break;
			cursor += 1;
		}
	}
	cursor = skipTrivia(source, cursor);
	if (source[cursor] !== "=")
		throw new LiteralParseError("配置声明不是纯数据字面量");
	const parsed = parseNode(source, cursor + 1);
	return { node: parsed.node, value: finalizeNode(parsed.node) };
};

export const indentOf = (source: string, at: number): string => {
	const lineStart = source.lastIndexOf("\n", Math.max(at - 1, 0)) + 1;
	const leading = source.slice(lineStart, at).match(/^[\t ]*/);
	return leading ? leading[0] : "";
};

const isPlainKey = (key: string): boolean => {
	if (key.length === 0) return false;
	if (!isIdentifierStart(key[0] ?? "")) return false;
	for (const character of key) {
		if (!isIdentifierPart(character)) return false;
	}
	return true;
};

const escapeKey = (key: string): string =>
	isPlainKey(key) ? key : JSON.stringify(key);

const stringifyWithIndent = (value: JsonLikeValue, indent: string): string => {
	const inner = indent + "\t";
	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		let rows = "";
		for (const item of value)
			rows = rows + inner + stringifyWithIndent(item, inner) + ",\n";
		return "[\n" + rows + indent + "]";
	}
	if (typeof value === "object" && value !== null) {
		const entries = Object.entries(value);
		if (entries.length === 0) return "{}";
		let rows = "";
		for (const [key, item] of entries)
			rows =
				rows +
				inner +
				escapeKey(key) +
				": " +
				stringifyWithIndent(item, inner) +
				",\n";
		return "{\n" + rows + indent + "}";
	}
	if (isLiteralRef(value)) throw new LiteralParseError("标识符引用不能被序列化");
	if (value === undefined) throw new LiteralParseError("undefined 不能被序列化");
	return JSON.stringify(value) ?? "null";
};

export const stringifyLiteral = (value: JsonLikeValue, indent?: string): string =>
	stringifyWithIndent(value, indent ?? "\t");

export const literalEquals = (left: unknown, right: unknown): boolean => {
	if (left === right) return true;
	if (isLiteralRef(left) || isLiteralRef(right)) {
		if (isLiteralRef(left) && isLiteralRef(right)) return left.$ref === right.$ref;
		return false;
	}
	if (Array.isArray(left) && Array.isArray(right)) {
		if (left.length !== right.length) return false;
		return left.every((item, index) => literalEquals(item, right[index]));
	}
	if (
		typeof left === "object" &&
		typeof right === "object" &&
		left !== null &&
		right !== null
	) {
		const leftKeys = Object.keys(left);
		const rightKeys = Object.keys(right);
		if (leftKeys.length !== rightKeys.length) return false;
		return leftKeys.every((key) =>
			literalEquals(
				(left as Record<string, unknown>)[key],
				(right as Record<string, unknown>)[key],
			),
		);
	}
	return false;
};

const describePath = (constName: string, path: (string | number)[]): string => {
	let result = constName;
	for (const segment of path) result = result + "." + String(segment);
	return result;
};

// 将 constName 字面量中 path 指向的值替换为 newValue，返回新文件内容。
// path 为空数组时替换整个字面量。目标不存在时抛错，绝不隐式新增结构。
export const patchConstValue = (
	source: string,
	constName: string,
	path: (string | number)[],
	newValue: JsonLikeValue,
): string => {
	const parsed = parseConst(source, constName);
	let target = parsed.node;
	for (const segment of path) {
		const child =
			typeof segment === "number"
				? target.items?.[segment]
				: target.members?.get(segment);
		if (!child)
			throw new LiteralParseError(
				"配置结构缺少路径：" + describePath(constName, path),
			);
		target = child;
	}
	const indent = indentOf(source, target.start) || "\t";
	const replacement = stringifyLiteral(newValue, indent);
	return source.slice(0, target.start) + replacement + source.slice(target.end);
};

// 读取 constName 字面量中 path 指向的节点（不存在返回 null）。
export const findConstNode = (
	source: string,
	constName: string,
	path: (string | number)[],
): LiteralNode | null => {
	try {
		const parsed = parseConst(source, constName);
		let target = parsed.node;
		for (const segment of path) {
			const child =
				typeof segment === "number"
					? target.items?.[segment]
					: target.members?.get(segment);
			if (!child) return null;
			target = child;
		}
		return target;
	} catch {
		return null;
	}
};
