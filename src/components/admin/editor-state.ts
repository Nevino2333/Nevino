import type { PublishTaskStatus } from "./admin-types";

type SaveState = {
	resourceId: string | null;
	sequence: number;
	snapshot: string;
};

export const canApplySaveResult = (
	request: SaveState,
	current: SaveState,
): boolean =>
	request.resourceId === current.resourceId &&
	request.sequence === current.sequence &&
	request.snapshot === current.snapshot;

export const canPublishEditor = (
	isDirty: boolean,
	publishBusy: boolean,
	hasDraft: boolean,
): boolean => hasDraft && !isDirty && !publishBusy;

export const canLeaveEditor = (
	isDirty: boolean,
	confirmLeave: () => boolean,
): boolean => !isDirty || confirmLeave();

export const canLogoutEditor: typeof canLeaveEditor = canLeaveEditor;

export const confirmDestructiveEditorAction = async (
	isDirty: boolean,
	confirmAction: () => boolean,
	action: () => Promise<unknown>,
): Promise<boolean> => {
	if (isDirty && !confirmAction()) return false;
	await action();
	return true;
};

export const performLogout = async (
	request: () => Promise<unknown>,
	clear: () => void,
	jump: () => void,
): Promise<void> => {
	await request();
	clear();
	jump();
};

export const shouldProtectBeforeUnload = (isDirty: boolean): boolean => isDirty;

export const shouldPollPublishTask = (status: PublishTaskStatus): boolean =>
	["pending", "publishing", "github_committed", "awaiting_deploy"].includes(
		status,
	);

export const canRecoverDeploymentWait = (status: PublishTaskStatus): boolean =>
	status === "awaiting_deploy";

export const pollPublishTaskWithRetry = async <
	T extends { status: PublishTaskStatus },
>(
	read: () => Promise<T>,
	wait: (milliseconds: number) => Promise<unknown>,
	options: {
		maxTransientErrors?: number;
		baseDelay?: number;
		isActive?: () => boolean;
	} = {},
): Promise<T | null> => {
	const maxTransientErrors = options.maxTransientErrors ?? 3;
	const baseDelay = options.baseDelay ?? 2000;
	let transientErrors = 0;
	while (true) {
		if (options.isActive && !options.isActive()) return null;
		try {
			const task = await read();
			transientErrors = 0;
			if (!shouldPollPublishTask(task.status)) return task;
			await wait(baseDelay);
		} catch (error) {
			if (
				(error as { status?: number }).status === 401 ||
				transientErrors >= maxTransientErrors
			)
				throw error;
			transientErrors += 1;
			await wait(baseDelay * 2 ** (transientErrors - 1));
		}
	}
};
