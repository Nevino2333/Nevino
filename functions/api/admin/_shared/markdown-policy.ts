export const forbiddenMarkdown = [
	/\.mdx\b/i,
	/^\s*(?:import|export)\b/m,
	/<\/?[A-Za-z][^>]*>/,
	/<\/?(?:script|style|svg|iframe|object|embed|form|input|textarea|button|link|meta)\b/i,
	/\bon[a-z][\w:-]*\s*=/i,
	/\b(?:javascript|data|vbscript):/i,
	/\{[#/:][^}]*\}/,
];

export const validateContent = (value: string): boolean =>
	typeof value === "string" &&
	value.length <= 500000 &&
	!forbiddenMarkdown.some((pattern) => pattern.test(value));

export const validateMarkdown = (value: string): boolean =>
	typeof value === "string" &&
	value.length <= 600000 &&
	value.startsWith("---\n") &&
	!forbiddenMarkdown.some((pattern) => pattern.test(value));
