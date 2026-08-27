export const draftPageCount = (total: number, pageSize: number): number =>
	Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));

export const clampDraftPage = (
	page: number,
	total: number,
	pageSize: number,
): number => Math.min(Math.max(1, page), draftPageCount(total, pageSize));
