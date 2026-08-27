import { parseDocument } from "yaml";
import { ApiError } from "./errors";
import { validateContent, validateMarkdown } from "./markdown-policy";
import type { DraftInput } from "./types";
import { validateDraft } from "./validation";

const yaml = (value: string): string =>
	value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", " ");

const allowedFrontmatterKeys = new Set([
	"title",
	"published",
	"updated",
	"draft",
	"description",
	"aiSummary",
	"image",
	"tags",
	"category",
	"lang",
	"pinned",
	"author",
	"sourceLink",
	"licenseName",
	"licenseUrl",
	"comment",
]);

export const toMarkdown = (draft: DraftInput, published = false): string =>
	`---\ntitle: "${yaml(draft.title)}"\npublished: ${draft.published}${draft.updated ? `\nupdated: ${draft.updated}` : ""}\ndraft: ${!published}\ndescription: "${yaml(draft.description ?? "")}"\naiSummary: "${yaml(draft.aiSummary ?? "")}"\nimage: "${yaml(draft.image ?? "")}"\ntags: [${(draft.tags ?? []).map((tag) => `"${yaml(tag)}"`).join(", ")}]\ncategory: "${yaml(draft.category ?? "")}"\nlang: "${yaml(draft.lang ?? "")}"\npinned: ${draft.pinned === true}\nauthor: "${yaml(draft.author ?? "")}"\nsourceLink: "${yaml(draft.sourceLink ?? "")}"\nlicenseName: "${yaml(draft.licenseName ?? "")}"\nlicenseUrl: "${yaml(draft.licenseUrl ?? "")}"\ncomment: ${draft.comment !== false}\n---\n\n${draft.content}`;

export const parseMarkdownDocument = (
	value: string,
	slug: string,
): DraftInput => {
	if (!value.startsWith("---\n") || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
		throw new ApiError(422, "markdown_invalid", "Markdown 无效");
	const closing = value.indexOf("\n---\n", 4);
	if (closing < 0) throw new ApiError(422, "markdown_invalid", "Markdown 无效");
	const source = value.slice(4, closing);
	if (/[&*][A-Za-z0-9_-]+/.test(source))
		throw new ApiError(
			422,
			"markdown_alias_forbidden",
			"Markdown frontmatter 不允许 alias",
		);
	const document = parseDocument(source, {
		schema: "core",
		prettyErrors: false,
		uniqueKeys: true,
	});
	if (document.errors.length)
		throw new ApiError(
			422,
			"markdown_frontmatter_invalid",
			"Markdown frontmatter 无效",
		);
	let metadata: unknown;
	try {
		metadata = document.toJS({ maxAliasCount: 0 });
	} catch {
		throw new ApiError(
			422,
			"markdown_frontmatter_invalid",
			"Markdown frontmatter 无效",
		);
	}
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
		throw new ApiError(
			422,
			"markdown_frontmatter_invalid",
			"Markdown frontmatter 无效",
		);
	const fields = metadata as Record<string, unknown>;
	if (Object.keys(fields).some((key) => !allowedFrontmatterKeys.has(key)))
		throw new ApiError(
			422,
			"markdown_field_unsupported",
			"Markdown 包含后台不支持的字段",
		);
	const body = value.slice(closing + 5).replace(/^\n/, "");
	const checked = validateDraft({ ...fields, slug, content: body });
	if (checked.data?.updated === undefined) delete checked.data.updated;
	if (!checked.data)
		throw new ApiError(
			422,
			"markdown_invalid",
			"Markdown 无效",
			false,
			Object.fromEntries(checked.errors.map((error) => [error, error])),
		);
	return checked.data;
};

export const parsePostMarkdown = parseMarkdownDocument;
export { validateContent, validateMarkdown };
