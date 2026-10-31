import type { AgentHarnessName } from "@nightshift/agents/types";
import type { FlowNodeType } from "@nightshift/flows";
import {
	type CostTally,
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
import { deriveSteps, deriveTrigger, sumCost } from "./run-views";

/**
 * A run as an export to monitoring reads it: its walks and steps with the
 * times each opened and ended, the sessions with their harness, model,
 * tokens and cost, the Gates' waits and the sleeps. A view of the run
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

/** One end of a step: from `openedAt` (its start or a reopen) to `at`. */
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
};

/** A harness session of an Agent step. */
export type TraceSession = {
	id: string;
	harness: AgentHarnessName;
	/** The model the harness said it runs. Null when it did not say. */
	model: string | null;
	startedAt: number;
	/** Null while it runs, or when it never ended. */
	endedAt: number | null;
	/** What it cost, or spent so far. Null: not known. */
	costUsd: number | null;
	costBasis: CostBasis;
	tokens: TokenCounts;
};

/** A time a step slept, and what for. `to` is null while it sleeps. */
export type TraceSleep = {
	from: number;
	to: number | null;
	reason: WaitReason;
};

/** A time a Gate of the step waited for a person. `to` is null while it waits. */
export type TraceGateWait = { from: number; to: number | null };

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
	ends: TraceStepEnd[];
	sessions: TraceSession[];
	gateWaits: TraceGateWait[];
	sleeps: TraceSleep[];
};

export type RunTrace = {
	runId: string;
	projectId: string | null;
	/** The flow it started from. Null for a quick run. */
	flowName: string | null;
	trigger: RunTrigger["kind"];
	startedAt: number | null;
	ends: TraceRunEnd[];
	/** The run's cost so far, and how sure it is. */
	costUsd: number;
	costBasis: CostBasis;
	steps: TraceStep[];
};

/** The run as monitoring reads it, from its run state. Null for a log with no run. */
export function runTrace(run: RunState): RunTrace | null {
	if (!run.runId) return null;
	const cost = sumCost(run);
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
		costUsd: cost.usd,
		costBasis: costBasis(cost),
		steps: deriveSteps(run).map((step) => ({
			id: step.id,
			nodeId: step.nodeId,
			nodeType: step.nodeType,
			visit: step.visit,
			parentStepId: step.scope?.parentStepId ?? null,
			deviceId: step.deviceId,
			startedAt: step.startedAt,
			ends: stepEnds(step),
			sessions: step.sessions.map((session) => {
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
			}),
			gateWaits: step.gateWaits.map(({ from, to }) => ({ from, to })),
			sleeps: step.sleeps.map(({ from, to, reason }) => ({ from, to, reason })),
		})),
	};
}

/** The dollars of a tally when all of them are known, else null. */
function knownUsd(cost: CostTally): number | null {
	return cost.calls > 0 && cost.missing === 0 ? cost.usd : null;
}

/** Each opening of the step that ended, with its end. */
function stepEnds(step: DerivedStep): TraceStepEnd[] {
	const ends: TraceStepEnd[] = [];
	for (const opening of step.openings) {
		const { end } = opening;
		if (!end) continue;
		ends.push({
			seq: end.seq,
			openedAt: opening.at,
			at: end.at,
			outcome: end.payload.outcome,
			error: end.payload.error,
			costUsd: knownUsd(end.cost),
			costBasis: costBasis(end.cost),
			first: ends.length === 0,
		});
	}
	return ends;
}
