type OperationStatus = { status: string } | null;

export const canConfirmTitle = (title: string, confirmation: string): boolean =>
	title === confirmation;

export const operationRequest = <Extra extends Record<string, string>>(
	expectedVersion: number,
	idempotencyKey: string,
	extra: Extra,
): { expectedVersion: number; idempotencyKey: string } & Extra => ({
	expectedVersion,
	idempotencyKey,
	...extra,
});

export type RollbackRequest = {
	expectedVersion: number;
	idempotencyKey: string;
	sourceCommitSha: string;
	expectedBlobSha: string;
	password: string;
};

export const rollbackRequest = (
	expectedVersion: number,
	idempotencyKey: string,
	sourceCommitSha: string,
	expectedBlobSha: string,
	password: string,
): RollbackRequest => ({
	expectedVersion,
	idempotencyKey,
	sourceCommitSha,
	expectedBlobSha,
	password,
});

export const rollbackRequestForDraft = (
	draft: { version: number; deployedBlobSha: string | null },
	idempotencyKey: string,
	sourceCommitSha: string,
	password: string,
): RollbackRequest => {
	if (!draft.deployedBlobSha) throw new Error("缺少当前部署 blob 证据");
	return rollbackRequest(
		draft.version,
		idempotencyKey,
		sourceCommitSha,
		draft.deployedBlobSha,
		password,
	);
};

export const isOperationPendingReconciliation = (
	operation: OperationStatus,
): boolean => operation?.status === "reconciliation_required";
