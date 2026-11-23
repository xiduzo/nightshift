import type { GateUrgency } from "@nightshift/flows";

import { runEndKey } from "../../contract";

/**
 * The run events that land in this Replica, as the notifier reads them:
 * the shape it reads of the engine's landed facts (`LandedFact`), and the
 * rules of one landing.
 */

/** One run event that landed: what it means, not its payload. */
export type NotifierFact = {
	spaceId: string;
	runId: string;
	/** The event's seq: a run's end is told once per end. */
	seq: number;
	/** What of the run it changes: `summary` is what a list of runs shows. */
	changes: "summary" | "detail" | "spend";
} & (
	| { kind: "gate-opened"; stepId: string; urgency?: GateUrgency }
	| {
			kind: "wait-started";
			stepId: string;
			reason: string;
			/** `device-offline`: the Device's name. Null: none, or a Walker of an older version. */
			deviceName: string | null;
	  }
	| { kind: "wait-ended"; stepId: string }
	| { kind: "step-ended"; stepId: string }
	| { kind: "run-ended"; status: string }
	| { kind: "scored" }
	| { kind: "other" }
);

/** The facts of one landing by Space, each Space's in their order. */
export function factsBySpace<F extends { spaceId: string }>(
	facts: readonly F[],
): Map<string, F[]> {
	const bySpace = new Map<string, F[]>();
	for (const fact of facts) {
		const list = bySpace.get(fact.spaceId) ?? [];
		list.push(fact);
		bySpace.set(fact.spaceId, list);
	}
	return bySpace;
}

/** A run that finished or failed: what it tells, under which key. */
export type RunEnd = {
	kind: "run-finished" | "run-failed";
	key: string;
	runId: string;
};

/** The runs of the facts that finished or failed, in their order. Another end tells nobody. */
export function endedRuns(facts: readonly NotifierFact[]): RunEnd[] {
	const ends: RunEnd[] = [];
	for (const fact of facts) {
		if (fact.kind !== "run-ended") continue;
		if (fact.status !== "finished" && fact.status !== "failed") continue;
		ends.push({
			kind: fact.status === "finished" ? "run-finished" : "run-failed",
			key: runEndKey(fact.runId, fact.seq),
			runId: fact.runId,
		});
	}
	return ends;
}

/**
 * The runs whose summary the facts changed, once each, that no item of
 * this landing told of yet. A Gate has an item of its own. A spend so
 * far, or what only the run's page shows, does not count.
 */
export function changedRuns(
	facts: readonly NotifierFact[],
	told: ReadonlySet<string>,
): Set<string> {
	return new Set(
		facts
			.filter(
				(f) =>
					f.changes === "summary" &&
					f.kind !== "gate-opened" &&
					!told.has(f.runId),
			)
			.map((f) => f.runId),
	);
}
