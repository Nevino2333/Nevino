import type {
	ContentPublicationState,
	ContentSyncStatus,
	ContentWorkspaceState,
} from "../types";

export type ContentState = {
	publicationState: ContentPublicationState;
	workspaceState: ContentWorkspaceState;
	syncStatus: ContentSyncStatus;
	deployed: boolean;
};

export type ContentCapabilities = {
	editable: boolean;
	publishable: boolean;
	renameable: boolean;
	withdrawable: boolean;
	deletable: boolean;
	reconcilable: boolean;
	discardable?: boolean;
};

const lockedCapabilities = (reconcilable: boolean): ContentCapabilities => ({
	editable: false,
	publishable: false,
	renameable: false,
	withdrawable: false,
	deletable: false,
	reconcilable,
});

export const contentCapabilities = (
	state: ContentState,
): ContentCapabilities => {
	if (state.syncStatus === "reconciliation_required")
		return lockedCapabilities(true);
	if (state.syncStatus === "publishing") return lockedCapabilities(false);

	const deployedAndClean =
		state.publicationState === "published" &&
		state.workspaceState === "clean" &&
		state.syncStatus === "published" &&
		state.deployed;
	if (deployedAndClean)
		return {
			editable: true,
			publishable: false,
			renameable: true,
			withdrawable: true,
			deletable: false,
			reconcilable: false,
			discardable: false,
		};

	return {
		editable: true,
		publishable: true,
		renameable: false,
		withdrawable: false,
		deletable: state.publicationState !== "published",
		reconcilable: false,
		...(state.publicationState === "published" &&
		state.workspaceState === "modified" &&
		state.deployed
			? { discardable: true }
			: state.publicationState === "withdrawn"
				? { discardable: false }
				: {}),
	};
};
