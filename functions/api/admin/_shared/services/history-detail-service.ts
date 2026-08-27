import { ApiError } from "../errors";
import { isAllowedGitHubPath } from "../github";
import { parsePostMarkdown } from "../markdown";
import type { DraftInput } from "../types";
import { createLineDiff, type DiffLine } from "./line-diff";

const commitPattern = /^[0-9a-f]{40}$/i;

export type TrustedHistoryRecord = {
	id: string;
	contentId: string;
	path: string;
	commitSha: string | null;
	blobSha?: string | null;
	markdown?: string;
};

export class HistoryDetailService {
	constructor(
		private readonly dependencies: {
			records: {
				getTrustedRecord(
					contentId: string,
					recordId: string,
				): Promise<TrustedHistoryRecord | null>;
			};
			github: {
				getFile(
					path: string,
					commitSha: string,
				): Promise<{ sha: string; content: string } | null>;
			};
		},
	) {}

	async get(input: {
		contentId: string;
		recordId: string;
		currentMarkdown: string;
	}): Promise<{
		record: TrustedHistoryRecord;
		blobSha: string;
		markdown: string;
		parsed: DraftInput | null;
		editable: boolean;
		diff: DiffLine[];
	}> {
		const record = await this.dependencies.records.getTrustedRecord(
			input.contentId,
			input.recordId,
		);
		if (!record || record.contentId !== input.contentId)
			throw new ApiError(404, "history_record_not_found", "历史记录不存在");
		if (!isAllowedGitHubPath(record.path))
			throw new ApiError(409, "history_record_untrusted", "历史记录证据无效");
		if (
			!record.markdown &&
			(!record.commitSha || !commitPattern.test(record.commitSha))
		)
			throw new ApiError(409, "history_record_untrusted", "历史记录证据无效");
		const file = record.markdown
			? { sha: record.blobSha ?? "", content: record.markdown }
			: await this.dependencies.github.getFile(
					record.path,
					record.commitSha as string,
				);
		if (!file)
			throw new ApiError(404, "history_content_not_found", "历史内容不存在");
		let parsed: DraftInput | null = null;
		try {
			parsed = parsePostMarkdown(file.content, record.path.split("/")[3] ?? "");
		} catch (error) {
			if (!(error instanceof ApiError)) throw error;
		}
		return {
			record,
			blobSha: file.sha,
			markdown: file.content,
			parsed,
			editable: parsed !== null,
			diff: createLineDiff(file.content, input.currentMarkdown),
		};
	}
}
