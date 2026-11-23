import type { MergeState, SplitState } from "../../../contract";

/** Where a Project of this computer's own personal Space goes on the Host. */
export type MergeTarget = { spaceId: string; projectId: string };

/** A merge as its row keeps it. */
export type MergeRow = {
	fromSpace: string;
	hostId: string;
	personId: string;
	state: MergeState;
	toSpace: string | null;
	/** Each Project of `fromSpace` by its id: where it goes. */
	projectMap: Record<string, MergeTarget>;
	/** This computer's Person: their id on the Host. */
	personMap: Record<string, string>;
	joined: string[];
	backup: string;
	createdAt: number;
	updatedAt: number;
};

/** A split as its row keeps it. */
export type SplitRow = {
	toSpace: string;
	fromSpace: string;
	hostId: string;
	hostName: string;
	personId: string;
	hostPersonId: string;
	state: SplitState;
	/** The Projects that came along. Empty until `moved`. */
	projects: string[];
	runs: number;
	/** How many schedules that named another Device are paused here now. */
	unpinned: number;
	backup: string;
};

/** The step of the membership that started and is not done. */
export type Unfinished =
	| { step: "merge"; row: MergeRow }
	| { step: "split"; row: SplitRow };
