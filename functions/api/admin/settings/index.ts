import { adminGet } from "../_shared/handler";
import { listSettingsGroups } from "../_shared/services/settings-service";

export const onRequestGet = adminGet(async (context) => {
	return listSettingsGroups(context.env);
});
