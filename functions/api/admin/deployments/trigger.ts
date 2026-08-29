import { audit, bestEffortAudit } from "../_shared/audit";
import { ApiError } from "../_shared/errors";
import { dispatchGitHubWorkflow, getGitHubConfig } from "../_shared/github";
import { adminMutation } from "../_shared/handler";

const WORKFLOW_FILE = "cloudflare-pages.yml";

export const onRequestPost = adminMutation(async (context) => {
	const config = getGitHubConfig(context.env);
	if (!config)
		throw new ApiError(503, "github_not_configured", "GitHub 集成未配置");
	await dispatchGitHubWorkflow(config, WORKFLOW_FILE);
	await bestEffortAudit(() =>
		audit(
			context.env,
			context.session.user_id,
			"deployment_trigger",
			context.request,
			{
				requestId: context.requestId,
				resourceType: "deployment",
				resourceId: WORKFLOW_FILE,
				result: "success",
			},
		),
	);
	return { triggered: true, workflow: WORKFLOW_FILE };
});
