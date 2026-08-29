import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ApiError } from "../../functions/api/admin/_shared/errors";
import {
	compareGitHubCommits,
	getGitHubConfig,
} from "../../functions/api/admin/_shared/github";
import type { Env } from "../../functions/api/admin/_shared/types";

const env = (branch: string | undefined): Env =>
	({
		GITHUB_TOKEN: "token",
		GITHUB_OWNER: "owner",
		GITHUB_REPO: "repo",
		GITHUB_BRANCH: branch,
	}) as Env;

test("GitHub 配置仅接受 master 分支", () => {
	assert.deepEqual(getGitHubConfig(env("master")), {
		token: "token",
		owner: "owner",
		repo: "repo",
		branch: "master",
	});
});

test("GitHub 分支不是 master 时返回明确错误", () => {
	assert.throws(
		() => getGitHubConfig(env("main")),
		(error: unknown) =>
			error instanceof ApiError && error.code === "github_branch_mismatch",
	);
});

test("GitHub 基础配置缺失时仍返回未配置", () => {
	assert.equal(getGitHubConfig(env(undefined)), null);
});

test("GitHub compare 返回 identical 和 ahead 关系", async () => {
	const originalFetch = globalThis.fetch;
	const requests: string[] = [];
	globalThis.fetch = (async (input: string | URL | Request) => {
		requests.push(String(input));
		return new Response(
			JSON.stringify({ status: requests.length === 1 ? "identical" : "ahead" }),
		);
	}) as typeof fetch;
	try {
		const config = getGitHubConfig(env("master"));
		assert.ok(config);
		assert.equal(
			await compareGitHubCommits(config, "base", "head"),
			"identical",
		);
		assert.equal(await compareGitHubCommits(config, "older", "head"), "ahead");
		assert.match(requests[0], /compare\/base\.\.\.head$/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("workflow 回调始终运行并携带专用 secret", async () => {
	const workflow = await readFile(
		new URL("../../.github/workflows/cloudflare-pages.yml", import.meta.url),
		"utf8",
	);
	assert.match(workflow, /name: Notify admin deployment callback/);
	assert.match(workflow, /if: \$\{\{ always\(\) \}\}/);
	assert.match(workflow, /CALLBACK_URL: \$\{\{ secrets\.DEPLOYMENT_CALLBACK_URL \}\}/);
	assert.match(
		workflow,
		/CALLBACK_SECRET: \$\{\{ secrets\.DEPLOYMENT_CALLBACK_SECRET \}\}/,
	);
	assert.match(workflow, /X-Deployment-Callback-Secret: \$CALLBACK_SECRET/);
	assert.doesNotMatch(
		workflow,
		/always\(\) && env\.CALLBACK_URL != '' && env\.CALLBACK_SECRET != ''/,
	);
});
