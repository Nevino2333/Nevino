import type { DraftInput } from "./types";

const yaml = (value: string): string => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", " ");
const forbiddenMarkdown = [
	/\.mdx\b/i,
	/^\s*(?:import|export)\b/m,
	/<\/?[A-Za-z][^>]*>/,
	/<\/?(?:script|style|svg|iframe|object|embed|form|input|textarea|button|link|meta)\b/i,
	/\bon[a-z][\w:-]*\s*=/i,
	/\b(?:javascript|data|vbscript):/i,
	/\{[#/:][^}]*\}/,
];

export const toMarkdown = (draft: DraftInput): string => `---\ntitle: "${yaml(draft.title)}"\npublished: ${draft.published}${draft.updated ? `\nupdated: ${draft.updated}` : ""}\ndraft: true\ndescription: "${yaml(draft.description ?? "")}"\naiSummary: "${yaml(draft.aiSummary ?? "")}"\nimage: "${yaml(draft.image ?? "")}"\ntags: [${(draft.tags ?? []).map((tag) => `"${yaml(tag)}"`).join(", ")}]\ncategory: "${yaml(draft.category ?? "")}"\nlang: "${yaml(draft.lang ?? "")}"\npinned: ${draft.pinned === true}\nauthor: "${yaml(draft.author ?? "")}"\nsourceLink: "${yaml(draft.sourceLink ?? "")}"\nlicenseName: "${yaml(draft.licenseName ?? "")}"\nlicenseUrl: "${yaml(draft.licenseUrl ?? "")}"\ncomment: ${draft.comment !== false}\n---\n\n${draft.content}\n`;

export const validateContent = (value: string): boolean => typeof value === "string" && value.length <= 500000 && !forbiddenMarkdown.some((pattern) => pattern.test(value));
export const validateMarkdown = (value: string): boolean => typeof value === "string" && value.length <= 600000 && value.startsWith("---\n") && !forbiddenMarkdown.some((pattern) => pattern.test(value));
