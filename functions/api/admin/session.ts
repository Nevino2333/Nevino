import { csrfToken } from "./_shared/auth";
import { adminGet } from "./_shared/handler";

export const onRequestGet = adminGet(async (context) => ({
	authenticated: true,
	csrfToken: await csrfToken(context.session.id, context.env.SESSION_SECRET),
}));
