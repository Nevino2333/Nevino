import { csrfToken } from "./_shared/auth";
import { adminGet } from "./_shared/handler";

export const onRequestGet = adminGet(async (context) => ({
	csrfToken: await csrfToken(context.session.id, context.env.SESSION_SECRET),
}));
