import { ApiError } from "../_shared/errors";
import { adminGet } from "../_shared/handler";
import { PublishTaskRepository } from "../_shared/repositories/publish-task-repository";
import { toPublishTaskDto } from "../_shared/services/publish-service";

const idOf = (context: {
	params: Record<string, string | undefined>;
}): string => context.params.id ?? "";

export const onRequestGet = adminGet(async (context) => {
	const task = await new PublishTaskRepository(context.env).get(idOf(context));
	if (!task) throw new ApiError(404, "not_found", "发布任务不存在");
	return toPublishTaskDto(task);
});
