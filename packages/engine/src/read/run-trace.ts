import type { AgentHarnessName } from "@nightshift/agents/types";
import type { FlowNodeType } from "@nightshift/flows";
import type {
	LoggedEvent,
	RunEnding,
	RunTrigger,
	StepOutcome,
	WaitReason,
} from "../log";
import { sessionCost, stepEndCost } from "./cost";
import { deriveTrigger } from "./derive-run";
import { bySeq, deriveSteps, sumCost } from "./derive-steps";
import {
	type CostBasis,
	costBasis,
	sessionTokens,
	type TokenCounts,
} from "./run-metrics";

/**
 * A run as an export to monitoring reads it: its walks and steps with the
 * times each opened and ended, the sessions with their harness, model,
 * tokens and cost, the Gates' waits and the sleeps. Pure over the event
 * log, like the run metrics beside it, so a reader outside the engine
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

/** The run of these events (one run's log) as monitoring reads it. Null for none. */
export function runTrace(events: readonly LoggedEvent[]): RunTrace | null {
	const runId = events.find((e) => e.runId !== null)?.runId;
	if (!runId) return null;
	const ordered = bySeq(events);
	const derived = deriveSteps(ordered);
	const cost = sumCost(ordered, derived);
	const started = ordered.find((e) => e.type === "RunStarted");

	const runEnds: TraceRunEnd[] = [];
	let walkFrom: number | null = null;
	const stepEnds = new Map<string, TraceStepEnd[]>();
	const stepOpen = new Map<string, number>();
	const sleeps = new Map<string, TraceSleep[]>();

	const closeSleeps = (at: number) => {
		for (const list of sleeps.values()) {
			const last = list.at(-1);
			if (last && last.to === null) last.to = at;
		}
	};

	for (const e of ordered) {
		if (e.type === "RunStarted" || e.type === "RunResumed") {
			walkFrom = e.at;
			closeSleeps(e.at);
			continue;
		}
		if (e.type === "RunEnded") {
			closeSleeps(e.at);
			runEnds.push({
				seq: e.seq,
				openedAt: walkFrom ?? e.at,
				at: e.at,
				status: e.payload.status,
				reason: e.payload.reason,
				first: runEnds.length === 0,
			});
			continue;
		}
		const stepId = e.stepId;
		if (!stepId) continue;
		if (e.type === "StepStarted" || e.type === "StepReopened") {
			stepOpen.set(stepId, e.at);
		} else if (e.type === "StepEnded" && stepOpen.has(stepId)) {
			const list = stepEnds.get(stepId) ?? [];
			const own = stepEndCost(e.payload);
			list.push({
				seq: e.seq,
				openedAt: stepOpen.get(stepId) ?? e.at,
				at: e.at,
				outcome: e.payload.outcome,
				error: e.payload.error,
				costUsd: own.calls > 0 && own.missing === 0 ? own.usd : null,
				first: list.length === 0,
			});
			stepEnds.set(stepId, list);
			// The first end after an opening counts, as the read model's.
			stepOpen.delete(stepId);
		}
		const list = sleeps.get(stepId) ?? [];
		const last = list.at(-1);
		const asleep = last !== undefined && last.to === null;
		if (e.type === "WaitStarted") {
			// A wait logged again in the same sleep (a new daemon) goes on with it.
			if (!asleep)
				list.push({ from: e.at, to: null, reason: e.payload.reason });
			sleeps.set(stepId, list);
		} else if (
			asleep &&
			(e.type === "WaitEnded" ||
				e.type === "StepEnded" ||
				e.type === "StepReopened")
		) {
			last.to = e.at;
		}
	}

	return {
		runId,
		projectId:
			started?.type === "RunStarted" ? started.payload.projectId : null,
		flowName: started?.type === "RunStarted" ? started.payload.flowName : null,
		trigger: deriveTrigger(ordered).kind,
		startedAt: started?.at ?? null,
		ends: runEnds,
		costUsd: cost.usd,
		costBasis: costBasis(cost),
		steps: derived.map((step) => ({
			id: step.id,
			nodeId: step.nodeId,
			nodeType: step.nodeType,
			visit: step.visit,
			parentStepId: step.scope?.parentStepId ?? null,
			deviceId: step.deviceId,
			startedAt: step.startedAt,
			ends: stepEnds.get(step.id) ?? [],
			sessions: step.sessions.map((session) => {
				const spent = sessionCost(session);
				return {
					id: session.id,
					harness: session.harness,
					model: session.model,
					startedAt: session.startedAt,
					endedAt: session.endedAt,
					costUsd: spent.calls > 0 && spent.missing === 0 ? spent.usd : null,
					costBasis: costBasis(spent),
					tokens: sessionTokens(session),
				};
			}),
			gateWaits: step.gateWaits.map(({ from, to }) => ({ from, to })),
			sleeps: sleeps.get(step.id) ?? [],
		})),
	};
}
