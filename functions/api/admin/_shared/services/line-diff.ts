import { ApiError } from "../errors";

export type DiffLine = {
	type: "context" | "add" | "remove";
	oldLine: number | null;
	newLine: number | null;
	text: string;
};

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_OUTPUT_LINES = 1000;
const MAX_MATRIX_CELLS = 250_000;

export const createLineDiff = (before: string, after: string): DiffLine[] => {
	if (
		new TextEncoder().encode(before).byteLength > MAX_INPUT_BYTES ||
		new TextEncoder().encode(after).byteLength > MAX_INPUT_BYTES
	)
		throw new ApiError(413, "diff_input_too_large", "差异输入过大");
	const oldLines = before.split("\n");
	const newLines = after.split("\n");
	if (oldLines.length * newLines.length > MAX_MATRIX_CELLS) {
		const removed = oldLines
			.slice(0, MAX_OUTPUT_LINES / 2)
			.map((text, index) => ({
				type: "remove" as const,
				oldLine: index + 1,
				newLine: null,
				text,
			}));
		const added = newLines
			.slice(0, MAX_OUTPUT_LINES - removed.length)
			.map((text, index) => ({
				type: "add" as const,
				oldLine: null,
				newLine: index + 1,
				text,
			}));
		return [...removed, ...added];
	}
	const lengths = Array.from(
		{ length: oldLines.length + 1 },
		() => new Uint32Array(newLines.length + 1),
	);
	for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
		for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
			lengths[oldIndex][newIndex] =
				oldLines[oldIndex] === newLines[newIndex]
					? lengths[oldIndex + 1][newIndex + 1] + 1
					: Math.max(
							lengths[oldIndex + 1][newIndex],
							lengths[oldIndex][newIndex + 1],
						);
		}
	}
	const result: DiffLine[] = [];
	let oldIndex = 0;
	let newIndex = 0;
	while (
		(oldIndex < oldLines.length || newIndex < newLines.length) &&
		result.length < MAX_OUTPUT_LINES
	) {
		if (oldLines[oldIndex] === newLines[newIndex]) {
			result.push({
				type: "context",
				oldLine: oldIndex + 1,
				newLine: newIndex + 1,
				text: oldLines[oldIndex] ?? "",
			});
			oldIndex += 1;
			newIndex += 1;
		} else if (
			newIndex < newLines.length &&
			(oldIndex >= oldLines.length ||
				lengths[oldIndex][newIndex + 1] >= lengths[oldIndex + 1][newIndex])
		) {
			result.push({
				type: "add",
				oldLine: null,
				newLine: newIndex + 1,
				text: newLines[newIndex] ?? "",
			});
			newIndex += 1;
		} else {
			result.push({
				type: "remove",
				oldLine: oldIndex + 1,
				newLine: null,
				text: oldLines[oldIndex] ?? "",
			});
			oldIndex += 1;
		}
	}
	return result;
};
