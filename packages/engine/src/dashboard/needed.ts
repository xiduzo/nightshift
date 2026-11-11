import { NEEDED_YOU_REASONS, type NeededYouReason } from "../read";
import { topRows } from "./stats";
import {
	type NeededGroup,
	type NeededRange,
	type NeededReasonCount,
	type NightCounts,
	OVERVIEW_ROWS,
} from "./types";

/**
 * Needed you, over runs: how many runs a person stepped in on, and why.
 * A run counts once, by the day it started. A run with two reasons counts
 * under both. The share is out of every run started, so the number falls
 * as the person leaves the loop.
 */

/** Why a run needed you: each reason once, in the order they first happened. Empty: it needed nobody. */
export function neededReasons(run: {
	neededYou?: readonly { reason: NeededYouReason }[];
}): NeededYouReason[] {
	const reasons: NeededYouReason[] = [];
	for (const { reason } of run.neededYou ?? []) {
		if (!reasons.includes(reason)) reasons.push(reason);
	}
	return reasons;
}

/** How many runs had each reason, the most runs first, then in the order of the reasons. */
export function countReasons(
	runs: readonly (readonly NeededYouReason[])[],
): NeededReasonCount[] {
	return NEEDED_YOU_REASONS.map((reason) => ({
		reason,
		runs: runs.filter((reasons) => reasons.includes(reason)).length,
	}))
		.filter((count) => count.runs > 0)
		.sort((a, b) => b.runs - a.runs);
}

/** A run with the start of its day, its group and why it needed you. */
export type RunNeeds = {
	runId: string;
	title: string;
	createdAt: number;
	day: number;
	group: string;
	reasons: NeededYouReason[];
};

/**
 * How often the runs of `days` needed you: in all, why, per day (`needed`
 * and `alone`, the runs that ran on their own), per group, and the newest
 * that did.
 */
export function neededRange(
	days: readonly number[],
	runs: readonly RunNeeds[],
): NeededRange {
	const needed = runs.filter((run) => run.reasons.length > 0);
	const byGroup = new Map<string, RunNeeds[]>();
	for (const run of runs) {
		byGroup.set(run.group, [...(byGroup.get(run.group) ?? []), run]);
	}
	const groups: NeededGroup[] = [...byGroup.entries()]
		.map(([label, ofGroup]) => {
			const reasons = ofGroup.map((run) => run.reasons);
			return {
				label,
				runs: ofGroup.length,
				needed: reasons.filter((list) => list.length > 0).length,
				reasons: countReasons(reasons),
			};
		})
		.filter((group) => group.needed > 0)
		.sort((a, b) => b.needed - a.needed || b.runs - a.runs);
	const perNight: NightCounts[] = days.map((day) => {
		const ofDay = runs.filter((run) => run.day === day);
		const neededOfDay = ofDay.filter((run) => run.reasons.length > 0).length;
		return {
			night: day,
			counts: { needed: neededOfDay, alone: ofDay.length - neededOfDay },
		};
	});
	return {
		runs: runs.length,
		needed: needed.length,
		reasons: countReasons(needed.map((run) => run.reasons)),
		perNight,
		groups: topRows(groups),
		latest: [...needed]
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, OVERVIEW_ROWS)
			.map((run) => ({
				runId: run.runId,
				runTitle: run.title,
				group: run.group,
				createdAt: run.createdAt,
				reasons: run.reasons,
			})),
	};
}
