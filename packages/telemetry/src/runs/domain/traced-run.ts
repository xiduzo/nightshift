/**
 * A run as the rules of the run export read it: the shapes of the engine's
 * `RunTrace` and `LandedFact` they need, declared here (the engine's types
 * stay out of `domain/`).
 */

/** A session of a step's part, as the records read it (`TraceSession` of the engine). */
export type TracedSession = {
	harness: string;
	model: string | null;
	costUsd: number | null;
	costBasis: string;
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
};

/** One end of a step, as the records read it (`TraceStepEnd` of the engine). */
export type TracedStepEnd = {
	seq: number;
	openedAt: number;
	at: number;
	outcome: string;
	error: string | null;
	costUsd: number | null;
	costBasis: string;
	first: boolean;
	sessions: TracedSession[];
	gateWaits: { from: number; to: number }[];
	sleeps: { from: number; to: number; reason: string }[];
	knowledge: { searches: number; reads: number };
	landing?: {
		ladder: string;
		rung: string;
		tier: string | null;
		unsure?: true;
	};
};

/** A step, as the records read it (`TraceStep` of the engine). */
export type TracedStep = {
	id: string;
	nodeId: string;
	nodeType: string;
	visit: number;
	parentStepId: string | null;
	deviceId: string | null;
	rung?: string;
	ends: TracedStepEnd[];
};

/** One end of a run, as the records read it (`TraceRunEnd` of the engine). */
export type TracedRunEnd = {
	seq: number;
	openedAt: number;
	at: number;
	status: string;
	reason: string | null;
	endReason?: string | null;
	first: boolean;
	neededYou: boolean;
};

/** A run as the records read it: the shape of the engine's `RunTrace` they need. */
export type TracedRun = {
	runId: string;
	projectId: string | null;
	flowName: string | null;
	trigger: string;
	startedAt: number | null;
	ends: TracedRunEnd[];
	steps: TracedStep[];
	test: boolean;
};

/** A landed fact that ends something or scores a run: the facts that have records. */
export type RecordedFact = { seq: number } & (
	| { kind: "step-ended"; stepId: string }
	| { kind: "run-ended" }
	| {
			kind: "scored";
			score: string;
			value: number;
			label: string | null;
			by: string | null;
	  }
);
