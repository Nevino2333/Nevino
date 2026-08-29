import assert from "node:assert/strict";
import test from "node:test";
import {
	canApplySaveResult,
	canLeaveEditor,
	canLogoutEditor,
	canPublishEditor,
	canReconcilePublishTask,
	canRecoverDeploymentWait,
	confirmDestructiveEditorAction,
	performLogout,
	pollPublishTaskWithRetry,
	shouldPollPublishTask,
	shouldProtectBeforeUnload,
} from "../../src/components/admin/editor-state";

test("dirty 编辑器禁止发布", () => {
	assert.equal(canPublishEditor(true, false, true), false);
	assert.equal(canPublishEditor(false, false, true), true);
});

test("保存期间继续编辑时不得用响应覆盖新内容", () => {
	assert.equal(
		canApplySaveResult(
			{ resourceId: "draft-1", sequence: 1, snapshot: "submitted" },
			{ resourceId: "draft-1", sequence: 1, snapshot: "edited" },
		),
		false,
	);
});

test("切换文章或较新保存开始后忽略旧保存响应", () => {
	const request = { resourceId: "draft-1", sequence: 1, snapshot: "submitted" };
	assert.equal(
		canApplySaveResult(request, {
			resourceId: "draft-2",
			sequence: 1,
			snapshot: "submitted",
		}),
		false,
	);
	assert.equal(
		canApplySaveResult(request, {
			resourceId: "draft-1",
			sequence: 2,
			snapshot: "submitted",
		}),
		false,
	);
});

test("dirty 编辑器仅在用户确认后允许离开", () => {
	assert.equal(
		canLeaveEditor(false, () => false),
		true,
	);
	assert.equal(
		canLeaveEditor(true, () => false),
		false,
	);
	assert.equal(
		canLeaveEditor(true, () => true),
		true,
	);
});

test("冲突重载和历史回滚在 dirty 时取消不会执行请求或覆盖", async () => {
	for (const action of ["reload", "rollback"] as const) {
		const events: string[] = [];
		const confirmed = await confirmDestructiveEditorAction(
			true,
			() => false,
			async () => events.push(action),
		);
		assert.equal(confirmed, false);
		assert.deepEqual(events, []);
	}
});

test("dirty 确认后才执行破坏性编辑器操作", async () => {
	const events: string[] = [];
	assert.equal(
		await confirmDestructiveEditorAction(
			true,
			() => true,
			async () => events.push("request"),
		),
		true,
	);
	assert.deepEqual(events, ["request"]);
});

test("beforeunload 仅保护 dirty 编辑器", () => {
	assert.equal(shouldProtectBeforeUnload(true), true);
	assert.equal(shouldProtectBeforeUnload(false), false);
});

test("logout 服务请求前确认 dirty 编辑器", () => {
	let confirmations = 0;
	assert.equal(
		canLogoutEditor(false, () => false),
		true,
	);
	assert.equal(
		canLogoutEditor(true, () => {
			confirmations += 1;
			return false;
		}),
		false,
	);
	assert.equal(confirmations, 1);
});

test("logout 仅在请求成功后清理并跳转", async () => {
	const events: string[] = [];
	await performLogout(
		async () => {
			events.push("request");
		},
		() => events.push("clear"),
		() => events.push("jump"),
	);
	assert.deepEqual(events, ["request", "clear", "jump"]);
});

test("logout 请求失败时留页并保留凭据状态", async () => {
	const events: string[] = [];
	await assert.rejects(
		performLogout(
			async () => {
				events.push("request");
				throw new Error("退出失败");
			},
			() => events.push("clear"),
			() => events.push("jump"),
		),
		/退出失败/,
	);
	assert.deepEqual(events, ["request"]);
});

test("awaiting_deploy 持续轮询并允许解除等待", () => {
	assert.equal(shouldPollPublishTask("awaiting_deploy"), true);
	assert.equal(canRecoverDeploymentWait("awaiting_deploy"), true);
	assert.equal(canRecoverDeploymentWait("publishing"), false);
	assert.equal(canRecoverDeploymentWait("build_failed"), false);
});

test("发布终态停止轮询", () => {
	assert.equal(shouldPollPublishTask("published"), false);
	assert.equal(shouldPollPublishTask("build_failed"), false);
});

test("待对账任务停止轮询并只允许对账操作", () => {
	assert.equal(shouldPollPublishTask("reconciliation_required"), false);
	assert.equal(canReconcilePublishTask("reconciliation_required"), true);
	assert.equal(canReconcilePublishTask("awaiting_deploy"), false);
	assert.equal(canReconcilePublishTask("published"), false);
});

test("轮询临时错误有限退避后继续并在终态停止", async () => {
	let reads = 0;
	const delays: number[] = [];
	const result = await pollPublishTaskWithRetry(
		async () => {
			reads += 1;
			if (reads < 3) throw new Error("temporary");
			return { status: "published" as const };
		},
		async (delay) => delays.push(delay),
	);
	assert.equal(result?.status, "published");
	assert.equal(reads, 3);
	assert.deepEqual(delays, [2000, 4000]);
});

test("轮询超过临时错误上限后抛出且 401 不由轮询重试", async () => {
	let reads = 0;
	await assert.rejects(
		pollPublishTaskWithRetry(
			async () => {
				reads += 1;
				throw Object.assign(new Error("temporary"), { status: 503 });
			},
			async () => {},
			{ maxTransientErrors: 2 },
		),
		/temporary/,
	);
	assert.equal(reads, 3);
	reads = 0;
	await assert.rejects(
		pollPublishTaskWithRetry(
			async () => {
				reads += 1;
				throw Object.assign(new Error("unauthorized"), { status: 401 });
			},
			async () => {},
		),
		/unauthorized/,
	);
	assert.equal(reads, 1);
});
