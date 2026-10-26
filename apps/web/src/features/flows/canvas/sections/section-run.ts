// What a folded Section shows on the run page: the state of the nodes it
// hides, and which of them runs now.

import type { OutcomeColor } from "@nightshift/flows";
import type { NodeRunState } from "../flow-node";
import type { StepState } from "../outcome-badge";

export type SectionRunSummary = {
	/** The member whose step runs now, or waits for a person, if any. */
	now: { nodeId: string; state: StepState } | null;
	/**
	 * The member whose step started last, and its state: the state of the
	 * Section as a whole. Null when the run never reached it.
	 */
	latest: { nodeId: string; state: StepState; color?: OutcomeColor } | null;
	/** Members whose latest step runs, or sleeps until the run goes on. */
	running: string[];
	/** Members whose latest step waits on a Gate. */
	waiting: string[];
	/** Members whose latest step failed or ended on an error. */
	failed: string[];
	/** How many members the run reached. */
	reached: number;
};

const ACTIVE = new Set<StepState>(["running", "waiting", "sleeping"]);
const FAILED = new Set<StepState>(["fail", "error"]);

/**
 * The run state of a Section's members. `order` lists the node of every
 * step in the order the steps started, so the last active member is the
 * one that runs now.
 */
export function sectionRunSummary(
	members: readonly string[],
	states: ReadonlyMap<string, NodeRunState>,
	order: readonly string[],
): SectionRunSummary {
	const inside = new Set(members);
	const summary: SectionRunSummary = {
		now: null,
		latest: null,
		running: [],
		waiting: [],
		failed: [],
		reached: 0,
	};
	for (const id of members) {
		const run = states.get(id);
		if (!run) continue;
		summary.reached += 1;
		if (run.state === "waiting") summary.waiting.push(id);
		else if (ACTIVE.has(run.state)) summary.running.push(id);
		else if (FAILED.has(run.state)) summary.failed.push(id);
	}
	for (let at = order.length - 1; at >= 0; at--) {
		const id = order[at] as string;
		const state = states.get(id)?.state;
		if (!inside.has(id) || !state) continue;
		summary.latest ??= { nodeId: id, state };
		if (ACTIVE.has(state)) {
			summary.now = { nodeId: id, state };
			break;
		}
	}
	// An active member is the Section's state, even when a later step ended.
	if (summary.now) summary.latest = summary.now;
	return summary;
}
