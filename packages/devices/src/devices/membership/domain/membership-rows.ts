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
	/** The Projects that moved later than the merge, and their Persons. */
	late: {
		projectMap: Record<string, MergeTarget>;
		personMap: Record<string, string>;
	} | null;
	backup: string;
	createdAt: number;
	updatedAt: number;
};

/** A schedule that a split paused on this computer. */
export type PausedSchedule = { projectId: string; scheduleId: string };

/** The schedules a split paused, and the Host and Person it left. */
export type PausedBySplit = Pick<
	SplitRow,
	"hostId" | "hostPersonId" | "fromSpace" | "paused"
>;

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
	/** The schedules of those Projects, paused on this computer only. */
	paused: PausedSchedule[];
	/** The Projects whose flows waited for the Host, by their id before the merge: their id now. */
	waiting: Record<string, string>;
	/** How many schedules that are on at the Host are paused here. */
	unpinned: number;
	backup: string;
};

/** The step of the membership that started and is not done. */
export type Unfinished =
	| { step: "merge"; row: MergeRow }
	| { step: "split"; row: SplitRow };
