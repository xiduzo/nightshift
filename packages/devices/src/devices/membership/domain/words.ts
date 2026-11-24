import { Refusal } from "@nightshift/refusal";

/** Why a merge cannot start now. */
export const MERGE_WORDS = {
	noHome: "This computer has no home Host. Join one first.",
	merged: "Your Personal is merged with your home Host already.",
	offline: "Your home Host does not answer now. Try again when it is online.",
	notListed:
		"Your home Host does not show your personal Space yet. Try again in a minute.",
	isHost:
		"Other devices use this computer as their Host. Its Personal stays as it is.",
	leaving:
		"This computer still leaves your old Host. Let the runs on this computer finish or stop them, then merge.",
	changed: "Your projects changed while they moved. Try again in a minute.",
	busy: "Night Shift moves your Personal now. Wait until it is done.",
} as const;

/** What the Flows page of a Project says once Night Shift moved it to the Host later than the others. */
export const movedLate = (hostName: string) =>
	`Night Shift moved this project to ${hostName}, with its flows, schedules and runs. It stayed on this computer when your Personal moved.`;

/**
 * The statuses of a run that is not done: a merge and a split wait for them.
 * An interrupted run has ended, as a stopped one has: it moves along, and
 * nobody can stop it to let the merge go on.
 */
export const NOT_DONE = ["running", "waiting", "sleeping"] as const;

/** Why a leave cannot start now. */
export const LEAVE_WORDS = {
	noHome: "This computer has no home Host.",
} as const;

/** Why a split cannot start now. */
export const SPLIT_WORDS = {
	notDone: (count: number) =>
		count === 1
			? "A run on this computer is not done yet. Let it finish or stop it, then leave."
			: `${count} runs on this computer are not done yet. Let them finish or stop them, then leave.`,
} as const;

/** The check of a merge that failed: why it does not go on now. */
export type MergeHeld = {
	held:
		| "noHome"
		| "isHost"
		| "merged"
		| "leaving"
		| "offline"
		| "notListed"
		| "changed"
		| "notDone";
	refusal: Refusal;
};

/** Builds a held check with its refusal. */
export function mergeHeld(why: MergeHeld["held"], words?: string): MergeHeld {
	const kind =
		why === "offline" || why === "notListed" ? "unavailable" : "conflict";
	return {
		held: why,
		refusal: new Refusal(
			kind,
			words ?? MERGE_WORDS[why as keyof typeof MERGE_WORDS],
		),
	};
}

/** The refusal when Personal still has runs that are not done. */
export function notDoneHeld(notDone: number): MergeHeld {
	return mergeHeld(
		"notDone",
		notDone === 1
			? "A run in Personal is not done yet. Let it finish or stop it, then merge."
			: `${notDone} runs in Personal are not done yet. Let them finish or stop them, then merge.`,
	);
}
