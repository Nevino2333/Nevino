import assert from "node:assert/strict";
import test from "node:test";
import { decidePublishTarget } from "../../functions/api/admin/_shared/services/publish-target";

test("首次发布只允许创建不存在的远端文件", () => {
	assert.deepEqual(decidePublishTarget(null, null), { mode: "create" });
});

test("未绑定草稿不能覆盖远端同路径文件", () => {
	assert.deepEqual(decidePublishTarget(null, "remote-sha"), {
		mode: "conflict",
		code: "content_path_occupied",
	});
});

test("已绑定且 SHA 一致时允许更新", () => {
	assert.deepEqual(decidePublishTarget("remote-sha", "remote-sha"), {
		mode: "update",
		sha: "remote-sha",
	});
});

test("已绑定文件缺失或 SHA 改变时拒绝更新", () => {
	assert.equal(decidePublishTarget("bound-sha", null).mode, "conflict");
	assert.equal(decidePublishTarget("bound-sha", "other-sha").mode, "conflict");
});
