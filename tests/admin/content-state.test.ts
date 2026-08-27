import assert from "node:assert/strict";
import test from "node:test";
import { contentCapabilities } from "../../functions/api/admin/_shared/services/content-state";

const deployed = {
	publicationState: "published" as const,
	workspaceState: "clean" as const,
	syncStatus: "published" as const,
	deployed: true,
};

test("已部署且工作副本干净的文章可以修订、重命名和撤回", () => {
	assert.deepEqual(contentCapabilities(deployed), {
		editable: true,
		publishable: false,
		renameable: true,
		withdrawable: true,
		deletable: false,
		reconcilable: false,
		discardable: false,
	});
});

test("已部署文章的本地修订只允许继续编辑和发布", () => {
	assert.deepEqual(
		contentCapabilities({ ...deployed, workspaceState: "modified" }),
		{
			editable: true,
			publishable: true,
			renameable: false,
			withdrawable: false,
			deletable: false,
			reconcilable: false,
			discardable: true,
		},
	);
});

test("已撤回且没有部署证据的文章可重新发布或删除", () => {
	assert.deepEqual(
		contentCapabilities({
			publicationState: "withdrawn",
			workspaceState: "modified",
			syncStatus: "local",
			deployed: false,
		}),
		{
			editable: true,
			publishable: true,
			renameable: false,
			withdrawable: false,
			deletable: true,
			reconcilable: false,
			discardable: false,
		},
	);
});

test("待对账状态只允许对账", () => {
	assert.deepEqual(
		contentCapabilities({
			...deployed,
			syncStatus: "reconciliation_required",
		}),
		{
			editable: false,
			publishable: false,
			renameable: false,
			withdrawable: false,
			deletable: false,
			reconcilable: true,
		},
	);
});

test("缺少部署证据时不能执行线上重命名或撤回", () => {
	assert.deepEqual(contentCapabilities({ ...deployed, deployed: false }), {
		editable: true,
		publishable: true,
		renameable: false,
		withdrawable: false,
		deletable: false,
		reconcilable: false,
	});
});

test("发布中的文章禁止并发操作", () => {
	assert.deepEqual(
		contentCapabilities({ ...deployed, syncStatus: "publishing" }),
		{
			editable: false,
			publishable: false,
			renameable: false,
			withdrawable: false,
			deletable: false,
			reconcilable: false,
		},
	);
});
