import { adminGet } from "../_shared/handler";
import { listSpecPages } from "../_shared/services/page-service";

export const onRequestGet = adminGet(async (context) => {
	return listSpecPages(context.env);
});
