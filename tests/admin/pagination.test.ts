import assert from "node:assert/strict";
import test from "node:test";
import {
	clampDraftPage,
	draftPageCount,
} from "../../src/components/admin/pagination";

test("分页页数使用服务端真实 total", () => {
	assert.equal(draftPageCount(41, 20), 3);
	assert.equal(draftPageCount(0, 20), 1);
});

test("total 变化时当前页限制在有效范围", () => {
	assert.equal(clampDraftPage(4, 41, 20), 3);
	assert.equal(clampDraftPage(0, 41, 20), 1);
});
