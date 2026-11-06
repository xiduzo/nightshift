import type { AgentHarnessName } from "@nightshift/agents/types";
import type { ItemState, JsonValue, NodeOutputs } from "@nightshift/flows";
import {
	addCost,
	type CostTally,
	type DerivedStep,
	type GateDeadline,
	type InputValues,
	NO_COST,
	type OpenGateFact,
	type RunRow,
	type RunState,
	type RunTrigger,
	scopeKey,
	sessionCost,
	visitKey,
} from "../log";
import type { RunStatus } from "../run-status";
import type { RunLease, RunService, ScopeTraversals } from "./views";

/**
 * Views of a run's state (`RunState`, one fold of its event log): what
 * the screens and the walk read beyond its folded facts. The status, the
 * end, the open Gates and the sleep are fields of the state. Here are the
 * projections of it: the steps as a list, the leases, the services, the
 * inputs, the variables, the cost and the clocks of its running steps.
 * None of them walks the log: the run state is the one place that reads
 * the events.
 */

/** The steps in the order they started. */
export function deriveSteps(run: RunState): DerivedStep[] {
	return [...run.steps.values()];
}

/** Whether a run with this status is still open: at work, waiting at a Gate, or asleep. */
export function isOpenStatus(status: RunStatus): boolean {
	return status === "running" || status === "waiting" || status === "sleeping";
}

/**
 * The services of the run (ADR 9): those that run now, oldest first. An
 * ended run shows those that ran until its end, stopped.
 */
export function deriveServices(run: RunState): RunService[] {
	const running = run.end === null;
	const holds = running ? run.holds : run.endedHolding;
	return holds.flatMap((hold) =>
		hold.kind === "service"
			? [
					{
						nodeId: hold.nodeId,
						scopeKey: scopeKey(hold.scope),
						state: running ? "running" : "stopped",
						section: hold.section?.id ?? null,
						since: hold.at,
						deviceId: hold.deviceId,
						command: hold.spec.start,
					} satisfies RunService,
				]
			: [],
	);
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
	const { sleep } = run;
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

/** The open Gate whose deadline comes first, or null when no open Gate has one. */
export function firstDeadline(
	run: RunState,
): (OpenGateFact & { deadline: GateDeadline }) | null {
	let first: (OpenGateFact & { deadline: GateDeadline }) | null = null;
	for (const gate of run.gates) {
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
	const stepId = run.gate?.stepId ?? run.sleep?.stepId;
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
	if (!run.latest || run.end) return [];
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
