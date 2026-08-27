export type PublishTargetDecision =
	| { mode: "create" }
	| { mode: "update"; sha: string }
	| {
			mode: "conflict";
			code:
				| "content_path_occupied"
				| "content_remote_missing"
				| "content_remote_changed";
	  };

export const decidePublishTarget = (
	boundSha: string | null,
	remoteSha: string | null,
): PublishTargetDecision => {
	if (!boundSha && !remoteSha) return { mode: "create" };
	if (!boundSha && remoteSha)
		return { mode: "conflict", code: "content_path_occupied" };
	if (boundSha && !remoteSha)
		return { mode: "conflict", code: "content_remote_missing" };
	if (boundSha !== remoteSha)
		return { mode: "conflict", code: "content_remote_changed" };
	return { mode: "update", sha: boundSha };
};
