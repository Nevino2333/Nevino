import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../functions/api/admin/_shared/errors";
import {
	commitGitHubDelete,
	commitGitHubRename,
	commitGitHubUpdate,
	type GitHubConfig,
	getGitHubFileAtRef,
	listGitHubFileHistory,
	listGitHubPostPaths,
} from "../../functions/api/admin/_shared/github";

const config: GitHubConfig = {
	token: "token",
	owner: "owner",
	repo: "repo",
	branch: "master",
};

const response = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status });

const withFetch = async (
	handler: (input: URL, init: RequestInit) => Response | Promise<Response>,
	operation: () => Promise<void>,
) => {
	const original = globalThis.fetch;
	const requests: { url: URL; init: RequestInit }[] = [];
	globalThis.fetch = (async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		const url = new URL(String(input));
		requests.push({ url, init: init ?? {} });
		return handler(url, init ?? {});
	}) as typeof fetch;
	try {
		await operation();
	} finally {
		globalThis.fetch = original;
	}
	return requests;
};

test("列举递归 tree 中符合白名单的 index.md 并排序", async () => {
	await withFetch(
		(url) => {
			assert.match(url.pathname, /git\/trees\/master$/);
			assert.equal(url.searchParams.get("recursive"), "1");
			return response({
				tree: [
					{ path: "src/content/posts/beta/index.md", type: "blob" },
					{ path: "src/content/posts/nope/readme.md", type: "blob" },
					{ path: "src/content/posts/alpha/index.md", type: "blob" },
					{ path: "src/content/posts/gamma/index.md", type: "tree" },
				],
			});
		},
		async () =>
			assert.deepEqual(await listGitHubPostPaths(config), [
				"src/content/posts/alpha/index.md",
				"src/content/posts/beta/index.md",
			]),
	);
});

test("读取指定 commit ref 的 base64 文件并返回最新 commit", async () => {
	await withFetch(
		(url) => {
			assert.equal(url.searchParams.get("ref"), "a".repeat(40));
			return response({
				sha: "blob-1",
				content: "aGVsbG8=",
				encoding: "base64",
			});
		},
		async () => {
			const file = await getGitHubFileAtRef(
				config,
				"src/content/posts/alpha/index.md",
				"a".repeat(40),
			);
			assert.deepEqual(file, {
				sha: "blob-1",
				content: "aGVsbG8=",
				encoding: "base64",
			});
		},
	);
});

test("路径历史携带白名单路径、branch、分页参数并映射提交摘要", async () => {
	await withFetch(
		(url) => {
			assert.equal(
				url.searchParams.get("path"),
				"src/content/posts/alpha/index.md",
			);
			assert.equal(url.searchParams.get("sha"), "master");
			assert.equal(url.searchParams.get("page"), "2");
			assert.equal(url.searchParams.get("per_page"), "10");
			return response([
				{
					sha: "commit-1",
					commit: {
						message: "title\nbody",
						author: { name: "A", date: "2026-01-01T00:00:00Z" },
					},
				},
			]);
		},
		async () =>
			assert.deepEqual(
				await listGitHubFileHistory(
					config,
					"src/content/posts/alpha/index.md",
					2,
					10,
				),
				[
					{
						sha: "commit-1",
						message: "title",
						authorName: "A",
						authorDate: "2026-01-01T00:00:00Z",
					},
				],
			),
	);
});

test("rename 通过 Git Data API 创建单个原子 commit", async () => {
	const bodies: unknown[] = [];
	const requests = await withFetch(
		(url, init) => {
			if (init.body) bodies.push(JSON.parse(String(init.body)));
			if (url.pathname.endsWith("/git/ref/heads/master"))
				return response({ object: { sha: "head-1" } });
			if (url.pathname.endsWith("/git/commits/head-1"))
				return response({ tree: { sha: "tree-1" } });
			if (url.pathname.endsWith("/git/blobs"))
				return response({ sha: "new-blob" });
			if (url.pathname.endsWith("/git/trees"))
				return response({ sha: "tree-2" });
			if (url.pathname.endsWith("/git/commits"))
				return response({ sha: "commit-2" });
			if (url.pathname.endsWith("/git/refs/heads/master"))
				return response({ object: { sha: "commit-2" } });
			throw new Error(`unexpected ${url}`);
		},
		async () => {
			assert.deepEqual(
				await commitGitHubRename(
					config,
					"src/content/posts/old/index.md",
					"src/content/posts/new/index.md",
					"hello",
					"head-1",
					"rename",
				),
				{ blobSha: "new-blob", commitSha: "commit-2" },
			);
		},
	);
	assert.equal(requests.at(-1)?.init.method, "PATCH");
	assert.deepEqual(bodies[1], {
		base_tree: "tree-1",
		tree: [
			{
				path: "src/content/posts/old/index.md",
				mode: "100644",
				type: "blob",
				sha: null,
			},
			{
				path: "src/content/posts/new/index.md",
				mode: "100644",
				type: "blob",
				sha: "new-blob",
			},
		],
	});
});

test("删除使用 expected head 且 tree 只删除目标路径", async () => {
	const bodies: unknown[] = [];
	await withFetch(
		(url, init) => {
			if (init.body) bodies.push(JSON.parse(String(init.body)));
			if (url.pathname.endsWith("/git/ref/heads/master"))
				return response({ object: { sha: "head-1" } });
			if (url.pathname.endsWith("/git/commits/head-1"))
				return response({ tree: { sha: "tree-1" } });
			if (url.pathname.endsWith("/git/trees"))
				return response({ sha: "tree-2" });
			if (url.pathname.endsWith("/git/commits"))
				return response({ sha: "commit-2" });
			return response({});
		},
		async () =>
			assert.deepEqual(
				await commitGitHubDelete(
					config,
					"src/content/posts/old/index.md",
					"head-1",
					"delete",
				),
				{ blobSha: null, commitSha: "commit-2" },
			),
	);
	assert.deepEqual(bodies[0], {
		base_tree: "tree-1",
		tree: [
			{
				path: "src/content/posts/old/index.md",
				mode: "100644",
				type: "blob",
				sha: null,
			},
		],
	});
});

test("更新通过 Git Data API 且校验 expected blob SHA", async () => {
	const bodies: unknown[] = [];
	const requests = await withFetch(
		(url, init) => {
			if (init.body) bodies.push(JSON.parse(String(init.body)));
			if (url.pathname.endsWith("/contents/src/content/posts/alpha/index.md"))
				return response({ sha: "blob-1", content: "aA==", encoding: "base64" });
			if (url.pathname.endsWith("/git/ref/heads/master"))
				return response({ object: { sha: "a".repeat(40) } });
			if (url.pathname.endsWith(`/git/commits/${"a".repeat(40)}`))
				return response({ tree: { sha: "tree-1" } });
			if (url.pathname.endsWith("/git/blobs")) return response({ sha: "blob-2" });
			if (url.pathname.endsWith("/git/trees")) return response({ sha: "tree-2" });
			if (url.pathname.endsWith("/git/commits")) return response({ sha: "commit-2" });
			if (url.pathname.endsWith("/git/refs/heads/master")) return response({ object: { sha: "commit-2" } });
			throw new Error(`unexpected ${url}`);
		},
		async () =>
			assert.deepEqual(
				await commitGitHubUpdate(config, "src/content/posts/alpha/index.md", "new", "blob-1", "a".repeat(40), "update"),
				{ blobSha: "blob-2", commitSha: "commit-2" },
			),
	);
	assert.equal(
		requests.some(
			({ url, init }) =>
				url.pathname.includes("/contents/") && init.method === "PUT",
		),
		false,
	);
});

test("路径、head 冲突和读取格式错误映射为受控 ApiError", async () => {
	await assert.rejects(
		getGitHubFileAtRef(config, "src/content/posts/../secret", "a".repeat(40)),
		(error: unknown) =>
			error instanceof ApiError && error.code === "path_not_allowed",
	);
	await assert.rejects(
		withFetch(
			() => response({ object: { sha: "other" } }),
			async () =>
				commitGitHubDelete(
					config,
					"src/content/posts/alpha/index.md",
					"expected",
					"delete",
				),
		),
		(error: unknown) =>
			error instanceof ApiError && error.code === "github_head_changed",
	);
	await assert.rejects(
		withFetch(
			() => response({ type: "dir" }),
			async () =>
				getGitHubFileAtRef(
					config,
					"src/content/posts/alpha/index.md",
					"a".repeat(40),
				),
		),
		(error: unknown) =>
			error instanceof ApiError && error.code === "github_read_failed",
	);
});
