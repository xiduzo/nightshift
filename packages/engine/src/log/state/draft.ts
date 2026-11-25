import type { LoggedEvent } from "../events";
import type { RunState, StepSleep } from "./run-state";

/**
 * The state while the fold changes it (`fold-run.ts`): a draft with lists
 * and maps of its own, and the two small steps every part of the fold uses.
 */

/** The state of a run whose log is empty. */
export function emptyState(): Draft {
	return {
		runId: null,
		lastSeq: Number.NEGATIVE_INFINITY,
		lastAt: null,
		status: "interrupted",
		end: null,
		gates: [],
		gate: null,
		sleep: null,
		started: null,
		latest: null,
		walk: null,
		budgetFrom: -1,
		ends: [],
		resumes: [],
		daemonResumes: 0,
		stopAt: null,
		stopAfterStep: false,
		stops: [],
		takeOvers: [],
		earlyWakes: [],
		stepsSinceWalk: 0,
		warnings: [],
		scores: [],
		pullRequest: null,
		runFolder: false,
		test: null,
		worktree: null,
		moves: [],
		edges: new Map(),
		lastEdge: null,
		waits: [],
		variables: new Map(),
		variableChanges: [],
		nodeOutputs: new Map(),
		visits: new Map(),
		steps: new Map(),
		sessions: new Map(),
		holds: [],
		endedHolding: [],
	};
}

/**
 * A state being folded. Its lists and maps are its own, so `apply` may
 * change them. The records in them (a step, a session) are never changed:
 * a change replaces the record, so a state handed out stays as it was.
 */
export type Draft = {
	-readonly [K in keyof RunState]: RunState[K] extends ReadonlyMap<
		infer Key,
		infer Value
	>
		? Map<Key, Value>
		: RunState[K] extends readonly (infer Item)[]
			? Item[]
			: RunState[K];
};

/** A draft with lists and maps of its own, over the records of `state`. */
export function draftOf(state: RunState): Draft {
	return {
		...state,
		gates: [...state.gates],
		waits: [...state.waits],
		ends: [...state.ends],
		resumes: [...state.resumes],
		stops: [...state.stops],
		takeOvers: [...state.takeOvers],
		earlyWakes: [...state.earlyWakes],
		warnings: [...state.warnings],
		scores: [...state.scores],
		moves: [...state.moves],
		edges: new Map(state.edges),
		variables: new Map(state.variables),
		variableChanges: [...state.variableChanges],
		nodeOutputs: new Map(state.nodeOutputs),
		visits: new Map(state.visits),
		steps: new Map(state.steps),
		sessions: new Map(state.sessions),
		holds: [...state.holds],
		endedHolding: [...state.endedHolding],
	};
}

export function logged<E extends LoggedEvent>(
	e: E,
): { seq: number; at: number; stepId: string | null; payload: E["payload"] } {
	return { seq: e.seq, at: e.at, stepId: e.stepId, payload: e.payload };
}

/** Closes the open span at the end of `spans` at `at`, or gives `spans` back. */
export function closeLast<T extends StepSleep>(
	spans: readonly T[],
	at: number,
): readonly T[] {
	const last = spans.at(-1);
	if (!last || last.to !== null) return spans;
	return [...spans.slice(0, -1), { ...last, to: at }];
}
