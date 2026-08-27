import type { DraftInput } from "./types";
import { validateContent } from "./markdown";

const limits = {
	slug: 100,
	title: 200,
	published: 40,
	updated: 40,
	description: 1000,
	aiSummary: 2000,
	image: 1000,
	tag: 50,
	category: 100,
	lang: 20,
	author: 200,
	sourceLink: 1000,
	licenseName: 200,
	licenseUrl: 1000,
	content: 500000,
} as const;

const secretPattern = /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|-----BEGIN [A-Z ]+ PRIVATE KEY-----)/;
const urlPattern = /^(?:https?:\/\/|\/|#)/i;

const stringField = (input: Record<string, unknown>, key: string, max: number, errors: string[], required = false): string | undefined => {
	const value = input[key];
	if (value === undefined && !required) return undefined;
	if (typeof value !== "string" || value.length > max) {
		errors.push(`invalid_${key}`);
		return undefined;
	}
	return value;
};

export const validateDraft = (value: unknown): { data?: DraftInput; errors: string[] } => {
	if (!value || typeof value !== "object" || Array.isArray(value)) return { errors: ["invalid_body"] };
	const input = value as Record<string, unknown>;
	const errors: string[] = [];
	const slug = stringField(input, "slug", limits.slug, errors, true) ?? "";
	const title = stringField(input, "title", limits.title, errors, true) ?? "";
	const published = stringField(input, "published", limits.published, errors, true) ?? "";
	const updated = stringField(input, "updated", limits.updated, errors);
	const description = stringField(input, "description", limits.description, errors);
	const aiSummary = stringField(input, "aiSummary", limits.aiSummary, errors);
	const image = stringField(input, "image", limits.image, errors);
	const category = stringField(input, "category", limits.category, errors);
	const lang = stringField(input, "lang", limits.lang, errors);
	const author = stringField(input, "author", limits.author, errors);
	const sourceLink = stringField(input, "sourceLink", limits.sourceLink, errors);
	const licenseName = stringField(input, "licenseName", limits.licenseName, errors);
	const licenseUrl = stringField(input, "licenseUrl", limits.licenseUrl, errors);
	const content = stringField(input, "content", limits.content, errors, true) ?? "";
	const tagsValue = input.tags;
	let tags: string[] | undefined;
	if (tagsValue !== undefined) {
		if (!Array.isArray(tagsValue) || !tagsValue.every((tag) => typeof tag === "string" && tag.length <= limits.tag)) errors.push("invalid_tags");
		else tags = tagsValue;
	}
	if (!tags) tags = [];
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) errors.push("invalid_slug");
	if (!title.trim()) errors.push("invalid_title");
	if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(published) || Number.isNaN(Date.parse(published))) errors.push("invalid_published");
	if (!content.trim() || secretPattern.test(content) || !validateContent(content)) errors.push("invalid_content");
	for (const field of [title, published, updated, description, aiSummary, image, category, lang, author, sourceLink, licenseName, licenseUrl, ...tags]) if (field !== undefined && secretPattern.test(field)) errors.push("sensitive_value");
	if (image !== undefined && image !== "" && !urlPattern.test(image)) errors.push("invalid_image");
	if (sourceLink !== undefined && sourceLink !== "" && !urlPattern.test(sourceLink)) errors.push("invalid_sourceLink");
	if (licenseUrl !== undefined && licenseUrl !== "" && !urlPattern.test(licenseUrl)) errors.push("invalid_licenseUrl");
	if (typeof input.pinned !== "undefined" && typeof input.pinned !== "boolean") errors.push("invalid_pinned");
	if (typeof input.comment !== "undefined" && typeof input.comment !== "boolean") errors.push("invalid_comment");
	if (errors.length) return { errors: [...new Set(errors)] };
	return { data: { slug, title, published, updated, description, aiSummary, image, tags, category, lang, pinned: input.pinned === true, author, sourceLink, licenseName, licenseUrl, comment: input.comment !== false, content } };
};
