import type { AgentHarnessName } from "@nightshift/agents/types";
import type { FlowNodeType } from "@nightshift/flows";
import {
	type CostTally,
	type DerivedSession,
	type DerivedStep,
	type RunEnding,
	type RunState,
	type RunTrigger,
	type StepOutcome,
	sessionCost,
	type WaitReason,
} from "../log";
import {
	type CostBasis,
	costBasis,
	sessionTokens,
	type TokenCounts,
} from "./run-metrics";
import { deriveSteps, deriveTrigger } from "./run-views";

/**
 * A run as an export to monitoring reads it: its walks and steps with the
 * times each opened and ended, and per part of a step the sessions with
 * their harness, model, tokens and cost, the Gates' waits and the sleeps. A view of the run
 * state, like the run metrics beside it, so a reader outside the engine
 * never reads an event's type or payload. Nothing here is stored.
 *
 * A step or a run can end more than once (a step reopened for an answer,
 * a run resumed): each end is listed with the `seq` of its event, so a
 * reader of the landed facts finds the part that one landing ended.
 */

/** One end of a run: the walk from `openedAt` (its start or a resume) to `at`. */
export type TraceRunEnd = {
	seq: number;
	openedAt: number;
	at: number;
	status: RunEnding;
	reason: string | null;
	/** The run's first end. A resumed run ends again. */
	first: boolean;
};

/**
 * One end of a step: the part from `openedAt` (its start or a reopen) to
 * `at`, with what happened in it. A session, a sleep and a Gate's wait
 * belong to the part they began in. What a step's ended parts cost adds
 * up to what the run's cost (the Spend tab) counts for the step.
 */
export type TraceStepEnd = {
	seq: number;
	openedAt: number;
	at: number;
	outcome: StepOutcome;
	error: string | null;
	/** What the step spent itself at this end (a decider), when it says. */
	costUsd: number | null;
	/** How sure `costUsd` is: `estimated` when it is priced from the tokens. */
	costBasis: CostBasis;
	/** The step's first end. A reopened step ends again. */
	first: boolean;
	/** The harness sessions that started in this part, also those that never ended. */
	sessions: TraceSession[];
	/** When a Gate of the step waited for a person in this part. */
	gateWaits: TraceGateWait[];
	/** When the step slept in this part, and what for. */
	sleeps: TraceSleep[];
	/** How often its agents searched and read the project's knowledge in this part. */
	knowledge: { searches: number; reads: number };
};

/** A harness session of an Agent step. */
export type TraceSession = {
	id: string;
	harness: AgentHarnessName;
	/** The model the harness said it runs. Null when it did not say. */
	model: string | null;
	startedAt: number;
	/** Null when it never ended. */
	endedAt: number | null;
	/** What it cost, or spent until the part ended. Null: not known. */
	costUsd: number | null;
	costBasis: CostBasis;
	tokens: TokenCounts;
};

/** A time a step slept in an ended part, and what for. The part's end closes it at the latest. */
export type TraceSleep = { from: number; to: number; reason: WaitReason };

/** A time a Gate of the step waited for a person in an ended part. */
export type TraceGateWait = { from: number; to: number };

export type TraceStep = {
	id: string;
	nodeId: string;
	nodeType: FlowNodeType;
	visit: number;
	/** The Call step it ran in. Null at the top level. */
	parentStepId: string | null;
	/** The Device it ran on. Null for steps from before Devices named it. */
	deviceId: string | null;
	startedAt: number;
	/** Each part of the step that ended, oldest first. */
	ends: TraceStepEnd[];
};

export type RunTrace = {
	runId: string;
	projectId: string | null;
	/** The flow it started from. Null for a quick run. */
	flowName: string | null;
	trigger: RunTrigger["kind"];
	startedAt: number | null;
	ends: TraceRunEnd[];
	steps: TraceStep[];
};

/** The run as monitoring reads it, from its run state. Null for a log with no run. */
export function runTrace(run: RunState): RunTrace | null {
	if (!run.runId) return null;
	const started = run.started;
	return {
		runId: run.runId,
		projectId: started?.payload.projectId ?? null,
		flowName: started?.payload.flowName ?? null,
		trigger: deriveTrigger(run).kind,
		startedAt: started?.at ?? null,
		ends: run.ends.map((end, i) => ({
			seq: end.seq,
			openedAt: end.openedAt,
			at: end.at,
			status: end.payload.status,
			reason: end.payload.reason,
			first: i === 0,
		})),
		steps: deriveSteps(run).map((step) => ({
			id: step.id,
			nodeId: step.nodeId,
			nodeType: step.nodeType,
			visit: step.visit,
			parentStepId: step.scope?.parentStepId ?? null,
			deviceId: step.deviceId,
			startedAt: step.startedAt,
			ends: stepEnds(step),
		})),
	};
}

/** The dollars of a tally when all of them are known, else null. */
function knownUsd(cost: CostTally): number | null {
	return cost.calls > 0 && cost.missing === 0 ? cost.usd : null;
}

function traceSession(session: DerivedSession): TraceSession {
	const spent = sessionCost(session);
	return {
		id: session.id,
		harness: session.harness,
		model: session.model,
		startedAt: session.startedAt,
		endedAt: session.endedAt,
		costUsd: knownUsd(spent),
		costBasis: costBasis(spent),
		tokens: sessionTokens(session),
	};
}

/** How often the step's agents used the knowledge between two seqs. */
function knowledgeIn(step: DerivedStep, from: number, to: number) {
	let searches = 0;
	let reads = 0;
	for (const use of step.knowledge) {
		if (use.seq < from || use.seq > to) continue;
		if (use.type === "KnowledgeSearched") searches++;
		else reads++;
	}
	return { searches, reads };
}

/** Each opening of the step that ended, with its end and what began in it. */
function stepEnds(step: DerivedStep): TraceStepEnd[] {
	const ends: TraceStepEnd[] = [];
	step.openings.forEach((opening, index) => {
		const { end } = opening;
		if (!end) return;
		ends.push({
			seq: end.seq,
			openedAt: opening.at,
			at: end.at,
			outcome: end.payload.outcome,
			error: end.payload.error,
			costUsd: knownUsd(end.cost),
			costBasis: costBasis(end.cost),
			first: ends.length === 0,
			sessions: step.sessions
				.filter((s) => s.opening === index)
				.map(traceSession),
			// The fold closes a sleep and a wait at the end of their part at the latest.
			gateWaits: step.gateWaits
				.filter((w) => w.opening === index)
				.map(({ from, to }) => ({ from, to: to ?? end.at })),
			sleeps: step.sleeps
				.filter((w) => w.opening === index)
				.map(({ from, to, reason }) => ({ from, to: to ?? end.at, reason })),
			knowledge: knowledgeIn(step, opening.seq, end.seq),
		});
	});
	return ends;
}
