import type { AgentHarnessName } from "@nightshift/agents/types";
import type { ItemState, JsonValue, NodeOutputs } from "@nightshift/flows";
import {
	addCost,
	type CostTally,
	type DerivedStep,
	type GateChoice,
	type GateDeadline,
	type InputValues,
	NO_COST,
	type RunResult,
	type RunRow,
	type RunState,
	type RunStatus,
	type RunTrigger,
	type RunWarningKind,
	scopeKey,
	sessionCost,
	visitKey,
	type WaitReason,
} from "../log";
import type { RunLease, RunResume, ScopeTraversals } from "./views";

/**
 * Views of a run's state (`RunState`, one fold of its event log): its
 * status and end, its sleep, Gates, stop time, resumes, inputs, steps,
 * variables, cost and the clocks of its running steps. None of them walks
 * the log: the run state is the one place that reads the events.
 */

/** One warning of a run, in the order they were logged. */
export type DerivedWarning = {
	stepId: string | null;
	kind: RunWarningKind;
	message: string;
	at: number;
};

export function deriveWarnings(run: RunState): DerivedWarning[] {
	return run.warnings.map((e) => ({
		stepId: e.stepId,
		kind: e.payload.kind,
		message: e.payload.message,
		at: e.at,
	}));
}

/** The steps in the order they started. */
export function deriveSteps(run: RunState): DerivedStep[] {
	return [...run.steps.values()];
}

/**
 * The run's status and why it ended. The latest of `RunStarted`,
 * `RunResumed` and `RunEnded` decides: an end gives its status, a start or a
 * resume means the run is `running`, `waiting` while a Gate is open, or
 * `sleeping` while a step waits for a usage limit or the network. A run
 * with none of them (the daemon died while it created the run) is
 * `interrupted`. `result`: the status of the End node that ended the run,
 * else null.
 */
export function deriveRunState(run: RunState): {
	status: RunStatus;
	reason: string | null;
	result: RunResult | null;
} {
	const { latest } = run;
	if (!latest) return { status: "interrupted", reason: null, result: null };
	if (latest.ended) {
		return {
			status: latest.ended.status,
			reason: latest.ended.reason,
			result: latest.ended.result ?? null,
		};
	}
	const open = (status: RunStatus) => ({ status, reason: null, result: null });
	if (deriveOpenGate(run)) return open("waiting");
	if (deriveSleep(run)) return open("sleeping");
	return open("running");
}

/** Whether a run with this status is still open: at work, waiting at a Gate, or asleep. */
export function isOpenStatus(status: RunStatus): boolean {
	return status === "running" || status === "waiting" || status === "sleeping";
}

/** When the run ended: the time of its `RunEnded`, or null while it is open again or never ended. */
export function deriveEndedAt(run: RunState): number | null {
	return run.latest?.ended ? run.latest.at : null;
}

/**
 * The leases of the run (ADR 7): those it holds now, oldest first, then
 * the one its Lease step waits for. An ended run holds none.
 */
export function deriveLeases(run: RunState): RunLease[] {
	const held: RunLease[] = run.holds.flatMap((hold) =>
		hold.kind === "lease"
			? [
					{
						name: hold.name,
						state: "held",
						nodeId: hold.nodeId,
						section: hold.section?.id ?? null,
						since: hold.at,
						holder: null,
					},
				]
			: [],
	);
	const sleep = deriveSleep(run);
	const lease = run.wait?.payload.lease;
	const step = sleep ? run.steps.get(sleep.stepId) : undefined;
	if (sleep?.reason !== "lease" || !lease || !step) return held;
	return [
		...held,
		{
			name: lease.name,
			state: "waiting",
			nodeId: step.nodeId,
			section: null,
			since: run.wait?.payload.since ?? step.startedAt,
			holder:
				lease.holder === null
					? null
					: { runId: lease.holder, title: lease.holderTitle ?? "" },
		},
	];
}

export type SleepFact = {
	stepId: string;
	reason: WaitReason;
	/** When the step continues; null while it waits for a signal with no timeout. */
	until: number | null;
	message: string;
	/** The signal the step waits for, else null. */
	signal: string | null;
	/** The key a webhook signal must have to wake it, else null: any does. */
	signalKey: string | null;
	/** The rules one of which a webhook signal must match to wake it; empty: any does. */
	signalRules: { outcome: string; when: string }[];
};

/**
 * The wait the run sleeps in: the latest `WaitStarted` of the current walk
 * with no `WaitEnded` after it, on a step that is still open, while the run
 * has not ended.
 */
export function deriveSleep(run: RunState): SleepFact | null {
	const { wait } = run;
	if (!wait?.stepId || !run.latest || run.latest.ended) return null;
	const step = run.steps.get(wait.stepId);
	if (!step || step.endedAt !== null) return null;
	return {
		stepId: wait.stepId,
		reason: wait.payload.reason,
		until: wait.payload.until,
		message: wait.payload.message,
		signal: wait.payload.signal ?? null,
		signalKey: wait.payload.signalKey ?? null,
		signalRules: wait.payload.signalRules ?? [],
	};
}

/** Where a run works: its worktree on the run's Device, its branch and the commit it started from. */
export type RunWorktree = Pick<RunRow, "worktreePath" | "branch" | "baseRef">;

/**
 * The run's worktree: the one `WorktreeCreated` logged, else the row's.
 * A run whose Device was offline at the start gets its worktree when the
 * Device is back: its row has none, and every Replica reads it from the
 * event, because a run row is never updated. A run from before the event
 * has it on its row only.
 */
export function runWorktree(row: RunWorktree, run: RunState): RunWorktree {
	return run.worktree
		? { ...run.worktree }
		: {
				worktreePath: row.worktreePath,
				branch: row.branch,
				baseRef: row.baseRef,
			};
}

/**
 * The run has no worktree yet: its Device was offline when it started, and
 * no step made it since. Every worktree has a branch, and the exchange
 * never empties one, so an empty branch says it on every Replica.
 */
export function awaitsWorktree(row: RunWorktree, run: RunState): boolean {
	return runWorktree(row, run).branch === "";
}

/**
 * Where a run's work is: the Device that has it now (the run's Device,
 * then the `to` of each `HandedOff`), and the run's worktree on each
 * Device it reached. The run's Device has none until its worktree is made.
 */
export function deriveWorktrees(
	run: RunState,
	row: { deviceId: string | null; walkerId: string; worktreePath: string },
): { holder: string; paths: Map<string, string> } {
	let holder = row.deviceId ?? row.walkerId;
	const paths = new Map<string, string>();
	if (row.worktreePath !== "") paths.set(holder, row.worktreePath);
	for (const move of run.moves) {
		if (move.kind === "handed-off") holder = move.payload.to;
		paths.set(holder, move.payload.worktreePath);
	}
	return { holder, paths };
}

/** Every resume of the run, oldest first. */
export function deriveResumes(run: RunState): RunResume[] {
	return run.resumes.map((e) => ({
		at: e.at,
		by: e.payload.by ?? "person",
		nodeId: e.payload.nodeId,
		reason: e.payload.reason ?? null,
		action: e.payload.action ?? "resume",
	}));
}

/** The values of the top-level flow's inputs (the params of a run from before flow format 2). */
export function deriveInputs(run: RunState): InputValues {
	const started = run.started?.payload;
	return started?.inputs ?? started?.params ?? {};
}

/** What started the run: a person unless `RunStarted` names a schedule. */
export function deriveTrigger(run: RunState): RunTrigger {
	return run.started?.payload.trigger ?? { kind: "manual" };
}

/** How often the run took each edge of one scope (default: the top level), by edge id. */
export function deriveTraversals(
	run: RunState,
	key = "",
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const e of run.edges.get(key)?.taken ?? []) {
		counts[e.payload.edgeId] = (counts[e.payload.edgeId] ?? 0) + 1;
	}
	return counts;
}

/**
 * How often each called flow took each of its edges: one entry per scope
 * (a Call step, or one element of a Call with `each`) that took an edge,
 * in the order of its first edge. The top level is `deriveTraversals`.
 */
export function deriveCalledTraversals(run: RunState): ScopeTraversals[] {
	const scopes: ScopeTraversals[] = [];
	for (const [key, { scope }] of run.edges) {
		if (scope) scopes.push({ scope, traversals: deriveTraversals(run, key) });
	}
	return scopes;
}

/**
 * What the run spent against its budget (`policy.budgetUsd`): the cost of
 * the sessions that started, and of the step ends (a decider), since the
 * run started or a person last resumed it. A resume gives the run its
 * budget again, like the step cap; a resume of the daemon after a restart
 * does not. A running session counts with its spend so far. An end counts
 * as the step's cost does: once per opening.
 */
export function deriveBudgetSpend(run: RunState): CostTally {
	let total = NO_COST;
	for (const session of run.sessions.values()) {
		if (session.startSeq > run.budgetFrom) {
			total = addCost(total, sessionCost(session));
		}
	}
	for (const step of run.steps.values()) {
		for (const { end } of step.openings) {
			if (end && end.seq > run.budgetFrom) total = addCost(total, end.cost);
		}
	}
	return total;
}

export type OpenGateFact = {
	stepId: string;
	nodeId: string;
	visit: number;
	question: string;
	choices: GateChoice[];
	/** The flow author let a person answer this Gate from the lock screen. */
	lockScreen: boolean;
	openedAt: number;
	/** When nobody answered by then, the Gate takes an option. Null without one. */
	deadline: GateDeadline | null;
};

/**
 * The Gate the run waits at: a Gate step that opened and has not ended,
 * while the run has not ended. A Gate step that started but never wrote
 * `GateOpened` (the daemon died in between) is not open: recovery
 * interrupts it like any other step. Parallel branches may wait at
 * several: this is the latest (`deriveOpenGates` has them all).
 */
export function deriveOpenGate(run: RunState): OpenGateFact | null {
	return deriveOpenGates(run).at(-1) ?? null;
}

/** Every Gate the run waits at, in the order the steps started: one per branch that waits. */
export function deriveOpenGates(run: RunState): OpenGateFact[] {
	const { latest } = run;
	if (!latest || latest.ended) return [];
	const gates: OpenGateFact[] = [];
	for (const step of run.steps.values()) {
		const { gate } = step;
		if (
			step.endedAt === null &&
			gate !== null &&
			gate.openedSeq > step.openedSeq &&
			gate.openedSeq > latest.seq
		) {
			gates.push({
				stepId: step.id,
				nodeId: step.nodeId,
				visit: step.visit,
				question: gate.question,
				choices: gate.choices,
				lockScreen: gate.lockScreen,
				openedAt: gate.openedAt,
				deadline: gate.deadline,
			});
		}
	}
	return gates;
}

/** The open Gate whose deadline comes first, or null when no open Gate has one. */
export function firstDeadline(
	run: RunState,
): (OpenGateFact & { deadline: GateDeadline }) | null {
	let first: (OpenGateFact & { deadline: GateDeadline }) | null = null;
	for (const gate of deriveOpenGates(run)) {
		const { deadline } = gate;
		if (deadline && (!first || deadline.at < first.deadline.at)) {
			first = { ...gate, deadline };
		}
	}
	return first;
}

/**
 * The step the run is parked at (an open Gate or a sleeping step) and the
 * calling steps around it, from the inside out. Empty when the run is not
 * parked. These steps stay open while the run waits or sleeps.
 */
export function parkedSteps(run: RunState): DerivedStep[] {
	const stepId = deriveOpenGate(run)?.stepId ?? deriveSleep(run)?.stepId;
	return stepId ? withEnclosing(run, stepId) : [];
}

/** A running step's time budget, as the log has it, and when it counts from. */
export type StepClock = {
	step: DerivedStep;
	/** The step's time budget in ms, or null without one. */
	timeoutMs: number | null;
	/** The step's idle limit in ms, or null without one. */
	idleMs: number | null;
	/**
	 * When the step's node last entered: the budget counts from here, and
	 * so does the idle clock until the step's transcript has a later entry.
	 */
	since: number;
};

/**
 * The clocks of the steps that run now (open, and not parked at a Gate or
 * in a sleep) and have a budget in the log (`StepBudget`). A step's timers
 * start again each time its node enters (`DerivedStep.clock`).
 */
export function deriveStepClocks(run: RunState): StepClock[] {
	if (!run.latest || run.latest.ended) return [];
	const parked = new Set(parkedSteps(run).map((s) => s.id));
	const clocks: StepClock[] = [];
	for (const step of run.steps.values()) {
		if (step.endedAt !== null || parked.has(step.id)) continue;
		const { timeoutMs, idleMs, since } = step.clock;
		if (timeoutMs === null && idleMs === null) continue;
		clocks.push({ step, timeoutMs, idleMs, since });
	}
	return clocks;
}

/** The state of each item of a Call step's visit, by item id. */
export function itemStates(step: DerivedStep): Record<string, ItemState> {
	const states: Record<string, ItemState> = {};
	for (const item of step.items) states[item.facts.id] = item.state;
	return states;
}

/** The template outputs of the latest ended visit of each node of one scope (default: the top level). */
export function deriveNodeOutputs(run: RunState, key = ""): NodeOutputs {
	return { ...run.nodeOutputs.get(key) };
}

/**
 * The variables of one scope (default: the top level) as the log has them:
 * the values the flow started with, then each step's writes in order.
 */
export function deriveVariables(
	run: RunState,
	key = "",
): Record<string, JsonValue> {
	return { ...run.variables.get(key) };
}

/** How many visits of the node (in one scope, default the top level) the run started so far. */
export function countVisits(run: RunState, nodeId: string, key = ""): number {
	return run.visits.get(visitKey(nodeId, key)) ?? 0;
}

/** The harness session id of the node's latest session (in one scope, default the top level) that has one. */
export function lastHarnessSessionOfNode(
	run: RunState,
	nodeId: string,
	key = "",
): string | null {
	let last: { startSeq: number; id: string } | null = null;
	for (const step of run.steps.values()) {
		if (step.nodeId !== nodeId || scopeKey(step.scope) !== key) continue;
		for (const s of step.sessions) {
			if (s.harnessSessionId && (!last || s.startSeq > last.startSeq)) {
				last = { startSeq: s.startSeq, id: s.harnessSessionId };
			}
		}
	}
	return last?.id ?? null;
}

/** The run's latest session that has a harness session id. */
export function lastHarnessSession(
	run: RunState,
): { harness: AgentHarnessName; harnessSessionId: string } | null {
	let found: { harness: AgentHarnessName; harnessSessionId: string } | null =
		null;
	for (const s of run.sessions.values()) {
		if (s.harnessSessionId) {
			found = { harness: s.harness, harnessSessionId: s.harnessSessionId };
		}
	}
	return found;
}

/**
 * The run's cost: what each session reported, plus what steps spent
 * outside sessions (a decider).
 */
export function sumCost(run: RunState): CostTally {
	let total = NO_COST;
	for (const step of run.steps.values()) total = addCost(total, step.cost);
	// A session whose step is missing from the log still cost money.
	for (const session of run.sessions.values()) {
		if (session.stepId && run.steps.has(session.stepId)) continue;
		total = addCost(total, sessionCost(session));
	}
	return total;
}

/** The step and the calling steps (Call) it runs in, from the inside out. */
export function withEnclosing(run: RunState, stepId: string): DerivedStep[] {
	const chain: DerivedStep[] = [];
	for (
		let step = run.steps.get(stepId);
		step && !chain.includes(step);
		step = step.scope ? run.steps.get(step.scope.parentStepId) : undefined
	) {
		chain.push(step);
	}
	return chain;
}
