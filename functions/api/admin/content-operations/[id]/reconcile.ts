import { ApiError } from "../../_shared/errors";
import {
	decodeGitHubContent,
	getGitHubConfig,
	getGitHubFileAtRef,
} from "../../_shared/github";
import { adminMutation } from "../../_shared/handler";
import { ContentOperationRepository } from "../../_shared/repositories/content-operation-repository";
import { RenameDeploymentService } from "../../_shared/services/rename-deployment-service";

const idOf = (context: {
	params: Record<string, string | undefined>;
}): string => context.params.id ?? "";

export const onRequestPost = adminMutation(async (context) => {
	const config = getGitHubConfig(context.env);
	if (!config)
		throw new ApiError(503, "github_not_configured", "GitHub 尚未配置", true);
	const operations = new ContentOperationRepository(context.env);
	return new RenameDeploymentService(operations, {
		getFile: async (path, ref) => {
			try {
				const file = await getGitHubFileAtRef(config, path, ref);
				const content = decodeGitHubContent(file);
				if (content === null)
					throw new ApiError(502, "github_read_failed", "GitHub 文件格式无效");
				return { sha: file.sha, content };
			} catch (error) {
				if (error instanceof ApiError && error.status === 404) return null;
				throw error;
			}
		},
	}).reconcile(idOf(context));
});
