import { adminGet } from "../_shared/handler";

type SessionListRow = {
	id: string;
	user_id: string;
	expires_at: number;
	created_at: string;
};

export const onRequestGet = adminGet(async (context) => {
	const result = await context.env.DB.prepare(
		"SELECT id, user_id, expires_at, created_at FROM admin_sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC",
	)
		.bind(context.session.user_id, Date.now())
		.all<SessionListRow>();
	const currentId = context.session.id;
	return {
		items: (result.results ?? []).map((row) => ({
			id: row.id,
			createdAt: row.created_at,
			expiresAt: row.expires_at,
			current: row.id === currentId,
		})),
	};
});
