import {
	FLOW_VERSION,
	type Flow,
	flowSchema,
	readFlow,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { instant } from "@nightshift/time";
import {
	type CostTally,
	type DerivedStep,
	NO_COST,
	type RunRow,
	type RunState,
	type Scope,
	type StepOutcome,
	scopeKey,
	type TestRun,
} from "../../log";
import { isTestRun, type RunStatus } from "../../run-status";
import { calledFlows } from "../called-flows";
import { landingsOf, runRungs } from "../ladder";
import { neededYouOf } from "../needed-you";
import { runPerson } from "../people";
import { reportOf } from "../report";
import { deriveScores, runMetrics } from "../run-metrics";
import {
	calledCosts,
	deriveInputs,
	deriveSteps,
	deriveTrigger,
	isOpenStatus,
	sumCost,
} from "../run-views";
import type {
	RunDetail,
	RunDevice,
	RunSummary,
	RunWalker,
	RunWarning,
	SubflowRun,
} from "../views";

/**
 * A run's summary, derived from its row and its event log (design rule:
 * the log is the read model). Pure: rows and run states in, the `views.ts`
 * shapes out. The start of a run, the scores, the walk and the reads of
 * `runs/views` all make a run's summary here, so its shape changes in one
 * file. The flow snapshot parsers are here too: the summary of a run with
 * Call nodes reads them.
 */

/** What a run page shows in place of a flow that does not read: no steps on a canvas. */
const NO_FLOW: Flow = flowSchema.parse({
	version: FLOW_VERSION,
	start: "none",
	nodes: [],
	edges: [],
});

/** What a person reads when a run cannot go on, by why its flow does not read. */
const CANNOT_WALK = {
	older:
		"This run is from an older version of Night Shift. Start the flow again.",
	newer:
		"This run is from a newer version of Night Shift. Update Night Shift to continue it.",
	invalid:
		"Night Shift cannot read the flow of this run. Start the flow again.",
} as const;

/** A column of a run's snapshots. Null when it is not JSON. */
function jsonOf(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * The flow the run started from, from the run's own snapshot, to walk it.
 * Refuses a snapshot that does not read (`readFlow`).
 */
export function parseRunFlow(row: Pick<RunRow, "flow">): Flow {
	const read = readFlow(jsonOf(row.flow));
	if (read.flow === null) throw new Refusal("invalid", CANNOT_WALK[read.why]);
	return read.flow;
}

/** Why nothing can continue a run whose flow an older Night Shift made, or null. */
export function olderRun(row: Pick<RunRow, "flow">): string | null {
	const read = readFlow(jsonOf(row.flow));
	return read.flow === null && read.why === "older" ? CANNOT_WALK.older : null;
}

/**
 * The flow of a run to show. A snapshot that does not read shows as a flow
 * without nodes, with why (`flowUnread`): the steps come from the log.
 */
export function shownRunFlow(
	row: Pick<RunRow, "flow">,
): Pick<RunDetail, "flow" | "flowUnread"> {
	const read = readFlow(jsonOf(row.flow));
	return read.flow === null
		? { flow: NO_FLOW, flowUnread: read.why }
		: { flow: read.flow };
}

/**
 * The flows of the run's Call nodes, by name (the `body_flows` column).
 * One that does not read is left out.
 */
export function parseCalledFlows(
	row: Pick<RunRow, "bodyFlows">,
): Record<string, Flow> {
	const flows: Record<string, Flow> = {};
	for (const [name, json] of Object.entries(jsonOf(row.bodyFlows) ?? {})) {
		const { flow } = readFlow(json);
		if (flow !== null) flows[name] = flow;
	}
	return flows;
}

/**
 * What a run summary reads from the run state. The run log keeps it per
 * run until the next append.
 */
export function runFacts(run: RunState) {
	const steps = deriveSteps(run);
	const { status, end, sleep } = run;
	const open = isOpenStatus(status);
	const cost = sumCost(run);
	const endedAt = end?.at ?? null;
	const report = reportOf(end, steps);
	return {
		status,
		reason: end?.reason ?? null,
		endReason: end?.endReason ?? null,
		result: end?.result ?? null,
		wakeAt: sleep?.until ?? null,
		signal: sleep?.signal ?? null,
		/** What the run sleeps for. Only `RunHere` carries it, not the summary. */
		waitReason: sleep?.reason ?? null,
		inputs: deriveInputs(run),
		stopAt: run.stopAt,
		stopAfterStep: open && run.stopAfterStep,
		/** When the run last did something. Null for an empty log: the summary has its start. */
		lastAt: run.lastAt,
		...costFields(cost),
		warnings: runWarnings(run),
		endedAt,
		trigger: deriveTrigger(run),
		calls: deriveCalls(steps),
		gates: steps
			.flatMap((step) =>
				step.gateWaits.map(({ from, to, answeredBy }) => ({
					openedAt: from,
					closedAt: to,
					answeredBy,
				})),
			)
			.sort((a, b) => a.openedAt - b.openedAt),
		/** Each time a person stepped in, oldest first (`neededYouOf`). */
		neededYou: neededYouOf(run),
		/** The start of the run's report (`reportOf`): never its full text. */
		...(report ? { report } : {}),
		sleeps: steps
			.flatMap((step) => step.sleeps.map(({ from, to }) => ({ from, to })))
			.sort((a, b) => a.from - b.from),
		/** The worktree the log names: a run row has none when its Device was offline at the start. */
		worktree: run.worktree,
		...(run.runFolder ? { runFolder: true } : {}),
		...(isTestRun(run) ? { test: testOf(run.test) } : {}),
		metrics: {
			...runMetrics(
				steps,
				cost,
				run.started?.at ?? null,
				endedAt,
				deriveScores(run),
				run.pullRequest?.url ?? null,
			),
			ladder: runRungs(landingsOf(steps)),
		},
	};
}

export type RunFacts = ReturnType<typeof runFacts>;

/** A test run's pinned and skipped nodes, by id, as its summary names them. */
function testOf(test: TestRun): { pinned: string[]; skipped: string[] } {
	return {
		pinned: Object.keys(test.pinned).sort(),
		skipped: Object.keys(test.skipped).sort(),
	};
}

/** A cost tally as the summaries carry it. */
export function costFields(cost: CostTally) {
	return {
		costUsd: cost.usd,
		costEstimated: cost.estimated,
		costMissing: cost.missing,
		costCalls: cost.calls,
	};
}

/** The run's warnings in the order they were logged, each with the node of its step. */
function runWarnings(run: RunState): RunWarning[] {
	return run.warnings.map((e) => ({
		kind: e.payload.kind,
		message: e.payload.message,
		stepId: e.stepId,
		nodeId: e.stepId ? (run.steps.get(e.stepId)?.nodeId ?? null) : null,
		at: e.at,
	}));
}

/** The Device a run's steps run on: its own, else (a run from before Placement) its Walker. */
export function runDeviceId(row: Pick<RunRow, "deviceId" | "walkerId">) {
	return row.deviceId ?? row.walkerId;
}

/**
 * A run's summary. `names`: the names of the Persons it names (`namesOf`).
 * `walker`: the Device that walks it; `device`: the one its steps run on
 * (default: the Walker).
 */
export function toSummary(
	row: RunRow,
	facts: RunFacts,
	names: ReadonlyMap<string, string>,
	walker: RunWalker,
	device: RunDevice = walker,
): RunSummary {
	const { calls, waitReason: _, worktree, lastAt, ...rest } = facts;
	const where = worktree ?? row;
	return {
		id: row.id,
		projectId: row.projectId,
		walker,
		device,
		startedBy: runPerson(row.startedBy, names),
		flowName: row.flowName,
		title: row.title,
		worktreePath: where.worktreePath,
		branch: where.branch,
		baseRef: where.baseRef,
		...rest,
		subflows: subflowRuns(row, calls, facts.status),
		createdAt: instant(row.createdAt),
		lastActivityAt: lastAt ?? instant(row.createdAt),
	};
}

/**
 * A Call step and its runs of the called flow, as the log has them. The
 * log names the flow of a Call once (`FlowCalled`), not the flow of a Call
 * with `each`: `subflowRuns` reads that from the run's flow snapshots.
 */
type CallFact = {
	/** The Call step's id. */
	id: string;
	nodeId: string;
	/** The Call step and item this step runs in. Null at the top level. */
	scope: Scope | null;
	/** Once: the flow it called. Null with `each`, or before it called. */
	flow: string | null;
	runs: {
		/** Null while the call or the item is open. */
		status: RunStatus | null;
		costUsd: number;
		costEstimated: boolean;
		costMissing: number;
		costCalls: number;
		startedAt: number;
		endedAt: number | null;
	}[];
};

/** How a Call step (once) ended, as the status of the flow it ran. */
const callStatus: Partial<Record<StepOutcome, RunStatus>> = {
	fail: "failed",
	error: "failed",
	stopped: "stopped",
	interrupted: "interrupted",
};

/** The Call steps of a run, with what each run of a called flow spent and how it ended. */
function deriveCalls(steps: readonly DerivedStep[]): CallFact[] {
	// The cost of each run of a called flow, with the flows it called, by scope key.
	const cost = calledCosts(steps, scopeKey);
	const calls: CallFact[] = [];
	for (const step of steps) {
		if (step.nodeType !== "call") continue;
		const ended =
			step.outcome === null ? null : (callStatus[step.outcome] ?? "finished");
		const once = { parentStepId: step.id, itemId: null };
		// Items run one at a time: a stop or a daemon death cuts the last one.
		const last = step.items.findLast((item) => item.state !== "blocked");
		calls.push({
			id: step.id,
			nodeId: step.nodeId,
			scope: step.scope,
			flow: step.call?.flow ?? null,
			runs: step.call
				? [
						{
							status: ended,
							...costFields(cost.get(scopeKey(once)) ?? NO_COST),
							startedAt: step.startedAt,
							endedAt: step.endedAt,
						},
					]
				: step.items
						// A blocked item never ran its flow.
						.filter((item) => item.state !== "blocked")
						.map((item) => ({
							status:
								item.state === "running"
									? null
									: item.state !== "failed"
										? "finished"
										: item === last &&
												(ended === "stopped" || ended === "interrupted")
											? ended
											: "failed",
							...costFields(
								cost.get(scopeKey({ ...once, itemId: item.facts.id })) ??
									NO_COST,
							),
							startedAt: item.startedAt,
							endedAt: item.endedAt,
						})),
		});
	}
	return calls;
}

/**
 * The runs of called flows inside a run, by flow name. The flow of a Call
 * with `each` comes from the node in the flow that holds it: the run's flow
 * at the top level, else the flow its parent Call step ran.
 */
function subflowRuns(
	row: RunRow,
	calls: readonly CallFact[],
	runStatus: RunStatus,
): SubflowRun[] {
	if (calls.length === 0) return [];
	// Parsed only when a Call with `each` needs them.
	let parsed: { flow: Flow; calledFlows: Record<string, Flow> } | null = null;
	const { calls: nameOf } = calledFlows(
		calls,
		() =>
			(parsed ??= {
				flow: shownRunFlow(row).flow,
				calledFlows: parseCalledFlows(row),
			}),
		(call) => call.flow,
	);
	return calls
		.flatMap((call) => {
			const flowName = nameOf(call);
			if (flowName === null) return [];
			return call.runs.map((run) => ({
				flowName,
				...run,
				status: run.status ?? runStatus,
			}));
		})
		.sort((a, b) => a.startedAt - b.startedAt);
}
