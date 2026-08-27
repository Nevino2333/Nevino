import { audit, bestEffortAudit } from "../../_shared/audit";
import { readJson } from "../../_shared/body";
import { ApiError } from "../../_shared/errors";
import { adminMutation } from "../../_shared/handler";
import { DraftRepository } from "../../_shared/repositories/draft-repository";
import { RevisionRepository } from "../../_shared/repositories/revision-repository";
import { toDetail } from "../../_shared/services/content-service";
import { DiscardRevisionService } from "../../_shared/services/discard-revision-service";

const idOf = (context: {
	params: Record<string, string | undefined>;
}): string => context.params.id ?? "";

export const onRequestPost = adminMutation(async (context) => {
	const parsed = await readJson(context.request, 4096);
	if (
		parsed.response ||
		!parsed.data ||
		typeof parsed.data !== "object" ||
		Array.isArray(parsed.data)
	)
		throw new ApiError(400, "invalid_request", "放弃修订请求无效");
	const expectedVersion = (parsed.data as Record<string, unknown>)
		.expectedVersion;
	if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1)
		throw new ApiError(422, "validation_failed", "版本无效");
	const drafts = new DraftRepository(context.env);
	const revisions = new RevisionRepository(context.env);
	const service = new DiscardRevisionService({
		get: (id) => drafts.get(id),
		getDeployedRevision: (id, commitSha) =>
			revisions.getByCommit(id, commitSha),
		restoreDeployedSnapshot: async (id, version, revision, draft, now) =>
			drafts.restoreDeployedSnapshot(id, version, revision, draft, now),
	});
	const restored = await service.discard(
		idOf(context),
		expectedVersion as number,
	);
	await bestEffortAudit(() =>
		audit(
			context.env,
			context.session.user_id,
			"draft_revision_discard",
			context.request,
			{
				requestId: context.requestId,
				resourceType: "draft",
				resourceId: restored.id,
				result: "success",
				metadata: { expectedVersion, version: restored.version },
			},
		),
	);
	return toDetail(restored);
});
