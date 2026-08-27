import { ApiError } from "../../_shared/errors";
import {
	decodeGitHubContent,
	getGitHubConfig,
	getGitHubFile,
} from "../../_shared/github";
import { adminMutation } from "../../_shared/handler";
import { DraftRepository } from "../../_shared/repositories/draft-repository";
import { PublishTaskRepository } from "../../_shared/repositories/publish-task-repository";
import { PublishService } from "../../_shared/services/publish-service";

const idOf = (context: {
	params: Record<string, string | undefined>;
}): string => context.params.id ?? "";

export const onRequestPost = adminMutation(async (context) => {
	const config = getGitHubConfig(context.env);
	if (!config)
		throw new ApiError(503, "github_not_configured", "GitHub 尚未配置", true);
	const service = new PublishService({
		drafts: new DraftRepository(context.env),
		tasks: new PublishTaskRepository(context.env),
		github: {
			async getFile(path) {
				const file = await getGitHubFile(config, path);
				return file
					? { sha: file.sha, content: decodeGitHubContent(file) }
					: null;
			},
			createFile: async () => {
				throw new Error("unsupported_operation");
			},
			updateFile: async () => {
				throw new Error("unsupported_operation");
			},
		},
	});
	return service.reconcile(idOf(context));
});
