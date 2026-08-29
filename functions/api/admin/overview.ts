import { adminGet } from "./_shared/handler";
import { buildOverview } from "./_shared/services/overview-service";

export const onRequestGet = adminGet(async (context) => {
	return buildOverview(context.env);
});
