import { adminMutation } from "../../_shared/handler";
import { PublishTaskRepository } from "../../_shared/repositories/publish-task-repository";
import { DeploymentRecoveryService } from "../../_shared/services/deployment-recovery-service";

const idOf = (context: {
	params: Record<string, string | undefined>;
}): string => context.params.id ?? "";

export const onRequestPost = adminMutation(async (context) =>
	new DeploymentRecoveryService(new PublishTaskRepository(context.env)).recover(
		idOf(context),
	),
);
