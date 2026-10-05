import type { PagesContext } from "./api/admin/_shared/types";

// /random —— 从已发布文章里随机挑一篇跳转（"手气不错"）。
// 文章清单读取构建产物 /api/allPostMeta.json（静态 JSON，无需访问数据库）。
interface RandomEnv {
	ASSETS: { fetch: (input: RequestInfo | URL) => Promise<Response> };
}

type PostMeta = {
	url?: string;
	password?: boolean;
};

export const onRequestGet = async (
	context: PagesContext<RandomEnv>,
): Promise<Response> => {
	const origin = new URL(context.request.url).origin;
	let posts: PostMeta[] = [];
	try {
		const listResponse = await context.env.ASSETS.fetch(
			`${origin}/api/allPostMeta.json`,
		);
		if (listResponse.ok) {
			posts = (await listResponse.json()) as PostMeta[];
		}
	} catch {
		// 清单读取失败时回退到首页
	}
	// 加密文章不参与随机
	const pool = posts.filter((post) => post?.url && !post.password);
	if (pool.length === 0) {
		return Response.redirect(`${origin}/`, 302);
	}
	const pick = pool[Math.floor(Math.random() * pool.length)];
	return new Response(null, {
		status: 302,
		headers: { Location: new URL(pick.url as string, origin).toString() },
	});
};
