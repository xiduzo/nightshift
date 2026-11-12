import { randomUUID } from "node:crypto";
import { Command, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { CostSource } from "@nightshift/agents/pricing";
import {
	applyVariableWrites,
	type FlowNode,
	type TemplateContext,
	type VariableResult,
} from "@nightshift/flows";
import type { Device } from "../device";
import { type KnowledgeUseEvent, knowledgeUseEvent } from "../knowledge";
import {
	type DerivedStep,
	type EnginePayloads,
	type FlowScore,
	flowScores,
	type GateChoice,
	type Hold,
	type RunState,
	type RunWarningKind,
	type Scope,
	type StandIn,
	type StepBudget,
	type StepEvent,
	type StepGuard,
	type StepOutcome,
	type StepOutputs,
	scopeKey,
} from "../log";
import type { StepMemory } from "../memory";
import { deriveBudgetSpend, deriveWorktrees, pullRequestOf } from "../read";
import { isTestRun } from "../run-status";
import { keptNames } from "../variables";
import { OUTRUN_ERROR, outrun, placeOf } from "./branches";
import { budgetPassed, runBudget } from "./budget";
import {
	type Climb,
	climbCommand,
	climbNext,
	climbOutputs,
	climbValues,
	stepRung,
} from "./cascade";
import {
	emit,
	keptFlowOf,
	pastStopTime,
	STOP_AFTER_STEP_REASON,
	STOP_TIME_REASON,
	type StepContext,
	stepFailure,
	stopAtOf,
	templateContext,
} from "./context";
import { openGate } from "./gate";
import type { WrittenBrief } from "./gate-brief";
import { keepShapes, stepShapes } from "./kept-shapes";
import { dataProblem } from "./output-schema";
import {
	entryOf,
	type ResumeRules,
	resumePoint,
	type StepEntry,
} from "./resume-point";
import {
	askNodeId,
	parkCommand,
	parkFailed,
	parkStopped,
	route,
	routeDone,
	type StepEnd,
	scopeOf,
} from "./route";
import { type DoneStep, positionOf } from "./run-position";
import {
	makeRunWorktree,
	readyRunFolder,
	restoreRunCopy,
	withLoggedWorktree,
} from "./run-worktree";
import {
	type DeviceWait,
	type OwnWait,
	type SleepRequest,
	sleep,
	type WaitRequest,
} from "./sleep";
import type {
	CascadeTry,
	PendingGate,
	RunStateUpdate,
	RunStateValues,
} from "./state";
import { type ChangesWatch, watchChanges } from "./step-changes";

/**
 * The step runner: one deep module that owns the lifecycle every step node
 * shares, behind one small interface, `runStep(ctx, node, state, config,
 * spec)`. A node module keeps only its body: what happens between
 * `StepStarted` and the step's end. The runner decides how the node enters
 * (`resumePoint`), runs the entry checks of a new visit, writes the `step`
 * row and the step's log events, opens the transcript and the timers,
 * translates an abort into the step's outcome, catches what the body
 * throws, hands a wait to the sleep module (`sleep()`, called from here
 * only), records what the step changed in the worktree (`step-changes.ts`)
 * and routes on the end (`route()`).
 *
 * Before this module every node repeated that skeleton around its own
 * work, and `StepHandle` was as wide as its implementation. Now the seam
 * between the runner and a body is `StepHandle` (what a body reads and
 * records) and `BodyResult` (how the body ended). Locality: a change to the
 * lifecycle lands in this file. Leverage: one table test
 * (`step-runner.test.ts`) covers the lifecycle for every kind.
 *
 * The loop-shaped nodes (a Call once, a Call with `each`, the Gate's two
 * graph nodes) open and close their step through the lower seam
 * `beginStep` / `OpenStep`: their step stays open across a subgraph or an
 * interrupt, which `runStep` does not model.
 *
 * The log is written exactly as before (design rule 3): the same payloads
 * in the same order as the nodes wrote them.
 *
 * Over 600 lines on purpose: this is the one module of the step lifecycle.
 * A cut would spread that lifecycle over the nodes again.
 */

/**
 * Why a step's signal aborted. `outrun`: another branch reached a `first`
 * Join (`branches.ts`). `idle`: the Agent showed no activity for its idle
 * limit (the stall guard). The guards a body trips (`StepHandle.halt`):
 * `budget` (the run passed its budget), `turns` (a session passed its turn
 * limit), `looping` (the same tool call three times in a row).
 */
export type AbortReason =
	| "stopped"
	| "timeout"
	| "idle"
	| "outrun"
	| GuardReason;

/** A guard of the run policy that a body trips. */
export type GuardReason = "budget" | "turns" | "looping";

/** The run warning each guard lands, and the stall guard's (`idle`). */
const GUARD_WARNINGS = {
	budget: "budget",
	turns: "turns",
	looping: "looping",
	idle: "stalled",
} as const satisfies Record<GuardReason | "idle", RunWarningKind>;

/**
 * How a node enters: a new visit (the default), or an existing step of the
 * node: `reopen` appends `StepReopened` (a person resumed a parked step, or
 * the daemon re-runs the node after a restart); `continue` appends nothing
 * (the step waited, and the wait ended). A `quiet` continue also tells the
 * bus and the custom stream nothing: the step did not start again (a Gate
 * that ends on its answer).
 */
export type StepStart =
	/**
	 * `untimed`: the step has no timers, whatever its kind says: the Gate of
	 * a cascade's person tier. `standIn`: the step stands in for its node in
	 * a test run (ADR 27): no timers, no Device, no rung.
	 */
	(
		| { kind: "new"; untimed?: true; standIn?: StandIn }
		| { kind: "reopen"; stepId: string; prompt: string | null }
		| { kind: "continue"; stepId: string; quiet?: boolean }
	) & {
		/**
		 * The step is a try of a cascade (ADR 6), or its person tier: its
		 * templates read `{{cascade.*}}`, and every end of the step adds the
		 * try's `tier` and `tries` to its outputs.
		 */
		climb?: Climb;
	};

/** One harness session of an Agent step, as the runner records it. */
export type SessionRecord = {
	id: string;
	/** The harness named its session: the row and `HarnessSessionAssigned`. */
	assigned(harnessSessionId: string, model: string | null): Promise<void>;
	/** `SessionUsage`: what the session has spent so far. */
	spent(payload: EnginePayloads["SessionUsage"]): Promise<void>;
	/** `SessionEnded` with how the session ended. */
	ended(payload: EnginePayloads["SessionEnded"]): Promise<void>;
};

/** A step in progress: what a node body reads and records. */
export type StepHandle = {
	stepId: string;
	visit: number;
	/** The Device the step runs on: the body's one way to touch a computer. */
	device: Device;
	/**
	 * The run's worktree on the step's Device, where a command or a session
	 * works. Another Device's path when the step runs there.
	 */
	worktree: string;
	/** The step as the log had it, for a reopened or continued step; null for a new visit. */
	existing: DerivedStep | null;
	/** The run state as read on entry, before this step's own events. */
	runState: RunState;
	tctx: TemplateContext;
	/** The step's own signal: a stop of the run, the node's time budget, or no activity for too long. */
	signal: AbortSignal;
	/** Writes one transcript entry (on disk, on the bus, on the custom stream). */
	record(sessionId: string | null, event: StepEvent): void;
	/** Resets the idle clock (Agent nodes with `idleMinutes`). */
	touch(): void;
	/**
	 * Starts a harness session of this step: the `agent_session` row and
	 * `SessionStarted` (one write of the drive), the bus. The body records
	 * the rest through the returned record, so no node touches the
	 * database.
	 */
	session(start: EnginePayloads["SessionStarted"]): Promise<SessionRecord>;
	/** Logs a warning about this step (`RunWarned`): it did not fail, but a person should know. */
	warn(kind: RunWarningKind, message: string): Promise<void>;
	/**
	 * Logs that an agent of the session searched or read the project's
	 * knowledge (`KnowledgeSearched`, `KnowledgeRead`). A failed write is
	 * left out: the step goes on.
	 */
	usedKnowledge(sessionId: string, used: KnowledgeUseEvent): Promise<void>;
	/**
	 * Trips a guard of the run policy: aborts the step's signal with the
	 * guard as its reason, so the session stops. The body then returns
	 * `aborted`; the runner ends the step `fail` with `message` and lands
	 * the guard's warning, or for `budget` stops the run `failed`. The
	 * first reason wins.
	 */
	halt(reason: GuardReason, message: string): void;
};

/**
 * The lower seam for the loop-shaped nodes: the body's handle plus how the
 * step opened and how it closes.
 */
export type OpenStep = StepHandle & {
	/** How the step was opened. */
	opened: StepStart["kind"];
	/**
	 * Closes the step: `StepEnded` in the log, the recorder and the timers
	 * closed, the bus and the custom stream told. The node then routes on
	 * the returned end (`route()`), or parks: `endAndGo` does the first.
	 */
	end(
		outcome: StepOutcome,
		outputs: StepOutputs,
		error: string | null,
		extra?: EndExtra & {
			/** The node's variable writes do not apply: a try of a cascade that climbs on. */
			skipWrites?: boolean;
		},
	): Promise<StepEnd>;
	/**
	 * Closes the step and goes on: a try of a cascade (`StepStart.climb`)
	 * that did not hold climbs to its next try while one is left, with none
	 * of the node's writes and no scores. Any other end scores what the
	 * step's data says (`dataScores`) and routes (`route()`), with `update`.
	 * `trail` is what the climb keeps of the try besides its outputs.
	 */
	endAndGo(
		outcome: StepOutcome,
		outputs: StepOutputs,
		error: string | null,
		extra?: EndExtra & {
			update?: RunStateUpdate;
			trail?: Partial<CascadeTry>;
		},
	): Promise<Command>;
	/** Closes the recorder and the timers but leaves the step open in the log (a wait). */
	leaveOpen(): void;
};

/** What a step's end records besides its outcome, outputs and error. */
type EndExtra = {
	costUsd?: number | null;
	costSource?: CostSource | null;
	harnessSessionId?: string | null;
	/** The guard that stopped the step. */
	guard?: StepGuard;
	/** What a Since last run step saw new or changed: saved with `StepEnded`. */
	memory?: StepMemory;
};

/**
 * What `beginStep` gives: a step to run, or the `command` the node returns
 * instead: the run parked before the step, or the node is on a branch
 * another branch outran, and goes no further (a command with no goto).
 */
export type BeginStep =
	| { kind: "step"; step: OpenStep }
	| { kind: "parked"; command: Command };

/** How a body ended its step; the runner writes `StepEnded` from it. */
export type BodyEnd = {
	kind: "end";
	outcome: StepOutcome;
	/** The step's outputs; the runner stamps `outcome` on them. */
	outputs: StepOutputs;
	error: string | null;
	/** What a decider cost, when one was asked: on `StepEnded` as `costUsd`. */
	costUsd?: number | null;
	/** Where that cost came from. Null: the decider answered, its cost is not known. */
	costSource?: CostSource | null;
	/** Agent steps: the harness session the step has, for a reopen. */
	harnessSessionId?: string | null;
	/**
	 * What a Since last run step saw new or changed: `StepEnded.memory`,
	 * saved in its batch. Left out when the step ends `error` instead.
	 */
	memory?: StepMemory;
	/**
	 * A try of a cascade: what the climb keeps of it besides its outputs,
	 * for the next try and the person tier (a Value's answer).
	 */
	trail?: Partial<CascadeTry>;
};

/**
 * What a body returns:
 *
 * - `end`: the step ended with this outcome; the runner routes on it.
 * - `aborted`: the body saw its signal abort and stopped its work; the
 *   runner reads the signal's reason and ends the step `stopped` (a person
 *   stopped the run) or `error` (the time budget, or no activity), with the
 *   outputs the body had so far.
 * - `wait`: a usage limit or a network failure (`WaitRequest`); the sleep
 *   module plans the policy's wait and parks at the wait node, or the step
 *   ends when the wait would pass the stop time or the grace is spent
 *   (`StepSpec.givesUp`).
 * - `sleep`: a Wait node worked out its own wake time (`OwnWait`); the
 *   sleep module persists it and parks at the wait node, the step open.
 * - `ask`: the body asks a person (an Agent with `ask`): the runner opens a
 *   Gate on the step (`openGate`) and goes to the node's ask node, the
 *   step open. `outputs` are what a Stop ends the step with.
 */
export type BodyResult =
	| BodyEnd
	| {
			kind: "aborted";
			outputs: StepOutputs;
			costUsd?: number | null;
			costSource?: CostSource | null;
			harnessSessionId?: string | null;
	  }
	| ({
			kind: "wait";
			costUsd?: number | null;
			costSource?: CostSource | null;
	  } & WaitRequest)
	| ({ kind: "sleep" } & OwnWait)
	| ({ kind: "offline" } & DeviceWait)
	| {
			kind: "ask";
			question: string;
			choices: GateChoice[];
			outputs: StepOutputs;
			/** The brief the agent gave with its question (ADR 21). */
			brief?: Omit<WrittenBrief, "cost">;
	  };

/** What a node tells the runner: how it re-enters, what its body does, what an empty end looks like. */
export type StepSpec = {
	/** Which existing step the node takes up again (`RESUME_RULES`). */
	rules: ResumeRules;
	/**
	 * The body: the node's own work, from `StepStarted` to its end. `entry`
	 * says how the step was entered, with the prompt and the harness session
	 * a continued or reopened step carries.
	 */
	body(step: StepHandle, entry: StepEntry): Promise<BodyResult>;
	/**
	 * The outputs of a step that ends before its body spoke (the wait ended
	 * past the stop time, the body threw, a wait gave up): the visit and the
	 * kind's empty fields. Default `{ visit }`.
	 */
	outputs?(step: StepHandle): StepOutputs | Promise<StepOutputs>;
	/**
	 * How the step ends when its Device cannot serve it. `why` is null
	 * when the step would wait past the run policy's network grace: a
	 * network wait that gives up, or a Device that stays offline that long.
	 * `why` says what happened when the Device cannot be made ready
	 * (`readyDevice`): the run's copy or folder cannot be made, or the run's
	 * work cannot move to it. Without it, a wait that gives up and a Device
	 * that is not ready end the step `error`, and the step sleeps as long as
	 * its Device is offline. An End that reads its report from a file has
	 * it: a report never fails a run (ADR 26).
	 */
	givesUp?(step: StepHandle, why: string | null): Promise<BodyEnd>;
	/** What the step's route writes besides its end: a Join closes its round. */
	update?: RunStateUpdate;
	/**
	 * The step is a try of a cascade (ADR 6, `climb.ts`): its templates read
	 * `{{cascade.*}}`, its outputs add `tier` and `tries`, and an end that
	 * does not hold climbs to the next try while one is left, instead of
	 * routing. A climbing end writes none of the node's variables and scores
	 * nothing: only the try that routes does.
	 */
	climb?: Climb;
	/**
	 * The step stands in for its node in a test run (`stand-in.ts`, ADR 27):
	 * the body only gives the pinned output or the skipped outcome. The
	 * step asks no Device, records no changes, and scores nothing.
	 */
	standIn?: StandIn;
};

/**
 * Runs one visit of `node`: enters, runs the body, ends, routes. Always
 * returns the `Command` the graph node returns.
 */
export async function runStep(
	ctx: StepContext,
	node: FlowNode,
	state: RunStateValues,
	config: LangGraphRunnableConfig,
	spec: StepSpec,
): Promise<Command> {
	const runState = await ctx.log.state(ctx.run.id);
	withLoggedWorktree(ctx, runState);
	const entry = resumePoint(node, state, runState, scopeOf(config), spec.rules);
	const extra = spec.update;
	const { climb } = spec;
	if (entry.kind === "done") {
		return doneAndGo(ctx, state, node, entry, config, climb, extra);
	}
	const start: StepStart =
		spec.standIn && entry.kind === "new"
			? { kind: "new", standIn: spec.standIn }
			: entryOf(entry);
	const begun = await beginStep(
		ctx,
		node,
		state,
		config,
		climb ? { ...start, climb } : start,
		runState,
	);
	if (begun.kind === "parked") return begun.command;
	const step = begun.step;
	const blank = async (outcome: StepOutcome): Promise<StepOutputs> => ({
		...(await (spec.outputs?.(step) ?? { visit: step.visit })),
		outcome,
	});
	const session = entry.kind === "new" ? null : entry.harnessSessionId;

	// The wait ended past the stop time (Night Shift was not running at
	// the wake): the step does not continue, a resume continues it.
	if (step.opened === "continue" && pastStopTime(ctx, state, config)) {
		const end = await step.end("stopped", await blank("stopped"), null, {
			harnessSessionId: session,
		});
		return parkStopped(node, end, STOP_TIME_REASON);
	}

	let result: BodyResult;
	let changes: ChangesWatch | null = null;
	try {
		// A stand-in works on no Device: it only gives its output.
		const notReady = spec.standIn ? null : await readyDevice(ctx, node, step);
		if (notReady?.kind === "end" && spec.givesUp) {
			result = await spec.givesUp(step, notReady.error);
		} else if (notReady) result = notReady;
		else {
			// Once the worktree is there: what the body changes in it.
			changes = spec.standIn ? null : await watchChanges(ctx, node, step);
			result = await spec.body(step, entry);
		}
	} catch (error) {
		result = {
			kind: "end",
			outcome: "error",
			outputs: await blank("error"),
			error: stepFailure(error, `node "${node.id}" of run ${ctx.run.id}`),
		};
	}
	// What the step changed, before it ends or pauses. A Wait node that
	// sleeps checks again later; an offline Device cannot tell.
	if (changes && result.kind !== "sleep" && result.kind !== "offline") {
		await changes.record();
	}

	const extraOf = (r: {
		costUsd?: number | null;
		costSource?: CostSource | null;
		harnessSessionId?: string | null;
	}) => ({
		...(r.costUsd !== undefined ? { costUsd: r.costUsd } : {}),
		...(r.costSource !== undefined ? { costSource: r.costSource } : {}),
		...(r.harnessSessionId !== undefined
			? { harnessSessionId: r.harnessSessionId }
			: {}),
	});
	/** Ends the step, then climbs or routes (`OpenStep.endAndGo`), with the spec's update. */
	const endAndGo = (
		outcome: StepOutcome,
		outputs: StepOutputs,
		error: string | null,
		more: EndExtra & { trail?: Partial<CascadeTry> },
	): Promise<Command> =>
		step.endAndGo(outcome, outputs, error, { ...more, update: extra });
	switch (result.kind) {
		case "end":
			return endAndGo(
				result.outcome,
				{ ...result.outputs, outcome: result.outcome },
				result.error,
				{
					...extraOf(result),
					...(result.memory ? { memory: result.memory } : {}),
					...(result.trail ? { trail: result.trail } : {}),
				},
			);
		case "aborted": {
			const aborted = abortEnd(ctx, node, step.signal, result.outputs);
			const reason = step.signal.reason as AbortReason | undefined;
			const guard =
				reason === "idle" ||
				reason === "budget" ||
				reason === "turns" ||
				reason === "looping"
					? reason
					: null;
			if (guard && aborted.error) {
				await step.warn(GUARD_WARNINGS[guard], aborted.error);
			}
			// The run's budget stops the run, not just the step: a resume
			// reopens the step with its session and a budget of its own.
			if (reason === "budget") {
				const end = await step.end(
					"stopped",
					{ ...result.outputs, outcome: "stopped" },
					aborted.error,
					{ ...extraOf(result), guard: "budget" },
				);
				return parkFailed(node, end, aborted.error ?? "", extra);
			}
			return endAndGo(aborted.outcome, aborted.outputs, aborted.error, {
				...extraOf(result),
				...(guard && guard !== "budget" ? { guard } : {}),
			});
		}
		case "ask":
			return askPerson(ctx, node, state, config, step, result);
		case "wait":
		case "sleep":
		case "offline": {
			const request: SleepRequest =
				result.kind === "wait"
					? { ...result, kind: "policy" }
					: result.kind === "sleep"
						? { ...result, kind: "own" }
						: {
								...result,
								kind: "device",
								...(spec.givesUp ? { grace: true as const } : {}),
							};
			const slept = await sleep(ctx, node, state, config, step, request);
			if (slept.kind === "asleep") return slept.command;
			// The step ends before its wait: with the session it has, and
			// what the decider cost before it hit the limit.
			const costs = result.kind === "wait" ? extraOf(result) : {};
			if (slept.kind === "stop-time") {
				const end = await step.end(
					"stopped",
					await blank("stopped"),
					null,
					costs,
				);
				return parkStopped(node, end, slept.reason);
			}
			if (spec.givesUp) {
				const instead = await spec.givesUp(step, null);
				return endAndGo(
					instead.outcome,
					{ ...instead.outputs, outcome: instead.outcome },
					instead.error,
					{ ...costs, ...extraOf(instead) },
				);
			}
			return endAndGo("error", await blank("error"), slept.error, costs);
		}
	}
}

/**
 * Goes on from a step the log has as ended whose route the checkpoint
 * lost (the daemon died before the commit): a try of a cascade that did
 * not hold climbs again while a try is left, any other end routes on
 * (`routeDone`) with `update`.
 */
export function doneAndGo(
	ctx: StepContext,
	state: RunStateValues,
	node: FlowNode,
	done: DoneStep,
	config: LangGraphRunnableConfig,
	climb?: Climb,
	update?: RunStateUpdate,
): Promise<Command> | Command {
	const logged: StepEnd = {
		stepId: done.step.id,
		visit: done.step.visit,
		outcome: done.ended.outcome,
		outputs: done.ended.outputs,
		error: done.ended.error,
	};
	const next = climb ? climbNext(climb, logged) : null;
	if (climb && next) return climbCommand(climb.root, logged, next);
	return routeDone(ctx, state, node, done, config, update);
}

/** The node types whose data may hold `scores`: the flow's own metrics (Q32). */
const SCORED_TYPES: ReadonlySet<FlowNode["type"]> = new Set([
	"command",
	"agent",
	"value",
]);

/**
 * The scores in the data of a Command, an Agent or a Value step
 * (`flowScores`), as `{"scores": {"found": 12}}`: one `Scored` each on the
 * step, after its `StepEnded`. One the step cannot keep is a warning
 * (`score`), never a failed step. The data of any other node is never read.
 */
async function dataScores(
	step: StepHandle,
	node: FlowNode,
	outputs: StepOutputs,
): Promise<FlowScore[]> {
	if (!SCORED_TYPES.has(node.type)) return [];
	const { scores, refused } = flowScores(outputs.data);
	for (const message of refused) await step.warn("score", message);
	return scores;
}

/**
 * Opens the Gate a body asks for and commits it as `pending`, then jumps to
 * the node's ask node, which interrupts until a person answers. The step
 * stays open in the log; its recorder and timers close. A Gate that cannot
 * open ends the step `error`.
 */
async function askPerson(
	ctx: StepContext,
	node: FlowNode,
	state: RunStateValues,
	config: LangGraphRunnableConfig,
	step: OpenStep,
	ask: Extract<BodyResult, { kind: "ask" }>,
): Promise<Command> {
	const { stepId, visit } = step;
	const choices = ask.brief?.choices ?? ask.choices;
	try {
		await openGate(ctx, step, {
			question: ask.question,
			choices,
			...(ask.brief ? { brief: { ...ask.brief, cost: null } } : {}),
		});
	} catch (error) {
		const end = await step.end(
			"error",
			{ ...ask.outputs, outcome: "error" },
			`The Gate could not open: ${stepFailure(error, `the Gate of node "${node.id}" of run ${ctx.run.id}`)}`,
		);
		return route(ctx, state, node, end, config);
	}
	step.leaveOpen();
	const pending: PendingGate = {
		kind: "gate",
		stepId,
		nodeId: node.id,
		visit,
		question: ask.question,
		choices,
		outputs: ask.outputs,
	};
	return new Command({ update: { pending }, goto: askNodeId(node.id) });
}

/** Why a step ran out of time: its end's error. `minutes` is the limit it ran past. */
export function budgetError(
	reason: "timeout" | "idle",
	minutes: number | undefined,
): string {
	return reason === "timeout"
		? `The step ran past its time budget of ${minutes} min.`
		: `The agent showed no activity for ${minutes} min, so the step stopped.`;
}

/**
 * The end an aborted step has, from its signal's reason: `error` with why
 * for the node's time budget; `fail` with why for a guard of the run
 * policy (no activity, a turn limit, a loop, the budget: `halted` has its
 * message); else `stopped` (a person stopped the run, or another branch
 * outran this one, which the error says). The outputs the body had so far
 * are kept.
 */
export function abortEnd(
	ctx: StepContext,
	node: FlowNode,
	signal: AbortSignal,
	outputs: StepOutputs,
): Pick<StepEnd, "outcome" | "outputs" | "error"> {
	const reason = signal.reason as AbortReason | undefined;
	const budget = () => ctx.kindOf(node).timeBudget(node, ctx.policy());
	if (reason === "timeout") {
		return {
			outcome: "error",
			outputs: { ...outputs, outcome: "error" },
			error: budgetError(reason, budget().timeoutMinutes),
		};
	}
	if (reason === "idle") {
		return {
			outcome: "fail",
			outputs: { ...outputs, outcome: "fail" },
			error: budgetError(reason, budget().idleMinutes),
		};
	}
	if (reason === "budget" || reason === "turns" || reason === "looping") {
		return {
			outcome: "fail",
			outputs: { ...outputs, outcome: "fail" },
			error: haltMessages.get(signal) ?? null,
		};
	}
	return {
		outcome: "stopped",
		outputs: { ...outputs, outcome: "stopped" },
		error: reason === "outrun" ? OUTRUN_ERROR : null,
	};
}

/** The message of the guard each halted step's signal aborted for (`StepHandle.halt`). */
const haltMessages = new WeakMap<AbortSignal, string>();

/**
 * Opens a step of `node` and returns what the node needs. For a new visit
 * it first runs the walk's entry checks, in this order, and parks the run
 * when one fires: a stop of the run (stopped, no reason), a stop after the
 * running step, the stop time (both stopped, with today's reasons), and the
 * step cap and the run's budget (failed, with why; the budget also lands a
 * `budget` warning). A continued or reopened step skips
 * them all: it is already in the log, and a stop must end it there (the old
 * walk had no entry check for one). It then writes the `step` row and
 * `StepStarted` (with the transcript path, the command log path, the
 * scope and the time budget), or `StepReopened` for a reopen (with the
 * time budget), and opens the transcript and the timers. Exactly
 * `runStep`'s scaffolding in the old engine. It asks
 * `ctx.placement.deviceFor` for the step's Device first, or, for a step
 * that follows the work (`NodeKind.followsWork`), takes the Device that
 * has the run's work now; `StepStarted` names it.
 *
 * `runState` is the run state as the caller read it on entry; without it
 * it is read here.
 */
export async function beginStep(
	ctx: StepContext,
	node: FlowNode,
	state: RunStateValues,
	config: LangGraphRunnableConfig,
	start: StepStart = { kind: "new" },
	runState?: RunState,
): Promise<BeginStep> {
	const runId = ctx.run.id;
	const scope = scopeOf(config);
	// Asked once per step: the body works on this Device, and a new step
	// records it. It works for the run: its calls read the run's Project
	// secrets (ADR 13).
	let device = ctx.placement.deviceFor(node, ctx.run);
	const logged = runState ?? (await ctx.log.state(runId));
	// A step that only reads the run's copy goes where the copy is: a
	// Hand-off would refuse what a step there did not commit.
	if (ctx.kindOf(node).followsWork(node) && !logged.runFolder) {
		const { holder } = deriveWorktrees(logged, ctx.run);
		device = ctx.placement.deviceById(holder, ctx.run);
	}
	// The kind says which timers a step has: a Gate waits as long as it
	// must, a Wait node keeps its own deadline across its sleeps, and only an
	// Agent step has an idle clock (its own, else the policy's). The log
	// keeps the same limits, so they hold when the timers do not
	// (`deriveStepClocks`).
	// A stand-in of a test run gives its output at once: it has no timers.
	const standIn = start.kind === "new" ? start.standIn : undefined;
	const { timeoutMinutes, idleMinutes } =
		start.kind === "new" && (start.untimed || standIn)
			? { timeoutMinutes: undefined, idleMinutes: undefined }
			: ctx.kindOf(node).timeBudget(node, ctx.policy());
	const budget: StepBudget = {
		...(timeoutMinutes ? { timeoutMs: timeoutMinutes * ctx.minuteMs } : {}),
		...(idleMinutes !== undefined
			? { idleMs: idleMinutes * ctx.minuteMs }
			: {}),
	};
	const parked = (
		status: "failed" | "stopped",
		reason: string | null,
		atStopTime = false,
	) => ({
		kind: "parked" as const,
		command: parkCommand({ node, status, reason, step: null, atStopTime }),
	});

	let stepId: string;
	let path: string;
	let visit: number;
	let existing: DerivedStep | null = null;
	if (start.kind === "new") {
		// A branch another branch outran starts nothing more.
		if (outrun(ctx, state, node, config)) {
			return {
				kind: "parked",
				command: new Command({ update: { pending: { [node.id]: null } } }),
			};
		}
		// Only a new visit parks before its step: a continued or reopened step
		// enters the node body with the aborted signal, so it ends `stopped`
		// with its session and a later resume can reopen it.
		if (ctx.signal().aborted) return parked("stopped", null);
		if (logged.stopAfterStep) {
			return parked("stopped", STOP_AFTER_STEP_REASON);
		}
		const stopAt = stopAtOf(state, config);
		if (stopAt !== null && ctx.now() >= stopAt) {
			return parked("stopped", STOP_TIME_REASON, true);
		}
		const limit = ctx.policy().maxSteps ?? ctx.settings().maxStepsPerRun;
		if (logged.stepsSinceWalk >= limit) {
			return parked(
				"failed",
				`The run reached the limit of ${limit} steps before node "${node.id}". Resume it to continue.`,
			);
		}
		const budgetUsd = runBudget(ctx);
		if (budgetUsd !== null) {
			const spent = deriveBudgetSpend(logged).usd;
			if (spent >= budgetUsd) {
				const reason = budgetPassed(budgetUsd, spent, node.id);
				await ctx.log.append({
					type: "RunWarned",
					runId,
					payload: { kind: "budget", message: reason },
				});
				return parked("failed", reason);
			}
		}
		stepId = randomUUID();
		path = ctx.log.files(runId).transcript(stepId);
		visit = positionOf(state, logged, scope).nextVisit(node);
		const logPath =
			!standIn && ctx.kindOf(node).logsCommandOutput(node)
				? ctx.log.files(runId).commandLog(stepId)
				: null;
		// Its rung, from the node with the cascade: a tier's node has none.
		// A stand-in is on no rung: nobody worked or decided.
		const rung = standIn
			? null
			: stepRung(
					start.climb?.root ??
						ctx.flow.nodes.find((each) => each.id === node.id) ??
						node,
					state,
				);
		// The log writes the step's row with its event, in one batch: a stop
		// lands before or after both. `deviceId` is the Device the step runs
		// on (its Placement), not the Walker. A stand-in runs on none.
		await ctx.log.append({
			type: "StepStarted",
			runId,
			stepId,
			payload: {
				nodeId: node.id,
				nodeType: node.type,
				visit,
				transcriptPath: path,
				logPath,
				scope,
				...(standIn ? { test: standIn } : { deviceId: device.id }),
				...(rung ? { rung } : {}),
				...budget,
			},
		});
	} else {
		existing = logged.steps.get(start.stepId) ?? null;
		if (!existing) throw new Error(`Step not found: ${start.stepId}`);
		stepId = existing.id;
		visit = existing.visit;
		// A step that moved goes on where it moved to: its session and its
		// work are there.
		if (existing.moved && existing.deviceId) {
			device = ctx.placement.deviceFor(node, ctx.run, existing.deviceId);
		}
		if (start.kind === "reopen") {
			await ctx.log.append({
				type: "StepReopened",
				runId,
				stepId,
				payload: { prompt: start.prompt, ...budget },
			});
		}
	}
	const changed = () =>
		ctx.bus.publish(runId, { kind: "step-changed", stepId });
	if (!(start.kind === "continue" && start.quiet)) {
		changed();
		emit(config, {
			type: "step-started",
			stepId,
			nodeId: node.id,
			visit,
			reopened: start.kind !== "new",
		});
	}

	const recorder = await ctx.recorders.open(runId, stepId);

	// The step's own signal: a stop of the run, the node's time budget, or
	// no activity for too long.
	const stepController = new AbortController();
	const runSignal = ctx.signal();
	const onStop = () => stepController.abort("stopped" satisfies AbortReason);
	if (runSignal.aborted) onStop();
	else runSignal.addEventListener("abort", onStop, { once: true });
	const timer = timeoutMinutes
		? setTimeout(
				() => stepController.abort("timeout" satisfies AbortReason),
				timeoutMinutes * ctx.minuteMs,
			)
		: undefined;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	const touch = () => {
		if (idleMinutes === undefined || stepController.signal.aborted) return;
		clearTimeout(idleTimer);
		idleTimer = setTimeout(
			() => stepController.abort("idle" satisfies AbortReason),
			idleMinutes * ctx.minuteMs,
		);
	};
	touch();
	// A step of a branch stops when another branch wins a `first` Join.
	const unrace = placeOf(ctx.flow, node.id)
		? ctx.races.running(scopeKey(scope), node.id, () =>
				stepController.abort("outrun" satisfies AbortReason),
			)
		: () => {};

	// A try of a cascade: what its templates read, and what every end adds.
	const { climb } = start;
	const climbed = climb ? climbOutputs(climb.root, climb.at) : null;

	let closed = false;
	const leaveOpen = () => {
		if (closed) return;
		closed = true;
		recorder.close();
		clearTimeout(timer);
		clearTimeout(idleTimer);
		runSignal.removeEventListener("abort", onStop);
		unrace();
	};

	const handle: OpenStep = {
		stepId,
		visit,
		device,
		// The run's worktree on this Device; a Hand-off sets it again.
		worktree: worktreeOn(ctx, logged, device) ?? ctx.run.worktreePath,
		existing,
		runState: logged,
		tctx: {
			...withServiceTails(
				ctx,
				templateContext(ctx, state, config),
				logged.holds,
				scope,
			),
			...(climb ? { cascade: climbValues(climb.root, climb.at) } : {}),
		},
		signal: stepController.signal,
		opened: start.kind,
		record(sessionId, stepEvent) {
			const entry = recorder.record(sessionId, stepEvent);
			emit(config, { type: "transcript", entry });
		},
		touch,
		halt(reason, message) {
			if (stepController.signal.aborted) return;
			haltMessages.set(stepController.signal, message);
			stepController.abort(reason satisfies AbortReason);
		},
		async warn(kind, message) {
			await ctx.log.append({
				type: "RunWarned",
				runId,
				stepId,
				payload: { kind, message },
			});
			changed();
		},
		async usedKnowledge(sessionId, { projectId, use }) {
			await ctx.log
				.append({
					...knowledgeUseEvent(projectId, use, "step"),
					runId,
					stepId,
					sessionId,
				})
				.then(changed, (error) => {
					console.warn("A use of the knowledge was not logged:", error);
				});
		},
		async session(started) {
			const sessionId = randomUUID();
			// The log writes the session's row with its event.
			await ctx.log.append({
				type: "SessionStarted",
				runId,
				stepId,
				sessionId,
				payload: started,
			});
			changed();
			return {
				id: sessionId,
				async assigned(harnessSessionId, model) {
					await ctx.log.append({
						type: "HarnessSessionAssigned",
						runId,
						stepId,
						sessionId,
						payload: { harnessSessionId, model },
					});
					changed();
				},
				async spent(payload) {
					await ctx.log.append({
						type: "SessionUsage",
						runId,
						stepId,
						sessionId,
						payload,
					});
					changed();
				},
				async ended(payload) {
					await ctx.log.append({
						type: "SessionEnded",
						runId,
						stepId,
						sessionId,
						payload,
					});
				},
			};
		},
		async end(ended, endOutputs, endError, extra) {
			leaveOpen();
			// The node's writes, before `StepEnded`: a write that does not fit
			// ends the step `error` instead, so the run parks and a person
			// can fix the flow and resume.
			let outcome = ended;
			let outputs = climbed ? { ...endOutputs, ...climbed } : endOutputs;
			let error = endError;
			const written = extra?.skipWrites
				? ({ ok: true, values: {} } as const)
				: await writeVariables(ctx, node, handle.tctx, outcome, outputs);
			if (!written.ok) {
				outcome = "error";
				outputs = { ...outputs, outcome };
				error = written.error;
			}
			const variables =
				written.ok && Object.keys(written.values).length > 0
					? written.values
					: undefined;
			// A test run keeps nothing that lasts (ADR 27): no kept values, no
			// memory and no shapes. Its steps still read them.
			const lasting = !isTestRun(logged);
			// A write of a kept variable saves it for the next run: the log
			// writes the values `kept` names, in the batch of the step's end.
			const keptFlow = variables && lasting ? keptFlowOf(ctx, scope) : null;
			const keptWritten =
				variables && keptFlow
					? Object.keys(variables).filter((name) =>
							keptNames(ctx.flow).has(name),
						)
					: [];
			// The shapes of the step's data, for a node with no schema yet:
			// the Walker keeps them on the node after the end (`kept-shapes.ts`).
			const shapes =
				extra?.skipWrites || !lasting
					? undefined
					: stepShapes(ctx, node, scope, outcome, outputs);
			// A stand-in's outputs are an earlier step's: it opened nothing.
			const opened = standIn ? null : pullRequestOf(outputs);
			if (opened) {
				await ctx.log.append({
					type: "PullRequestOpened",
					runId,
					payload: { url: opened },
				});
			}
			await ctx.log.append({
				type: "StepEnded",
				runId,
				stepId,
				payload: {
					outcome,
					outputs,
					error,
					...(variables ? { variables } : {}),
					...(keptFlow && keptWritten.length > 0
						? {
								kept: { flowName: keptFlow.flowName, names: keptWritten },
							}
						: {}),
					...(extra?.costUsd !== undefined ? { costUsd: extra.costUsd } : {}),
					...(extra?.costSource !== undefined
						? { costSource: extra.costSource }
						: {}),
					...(written.ok && extra?.guard ? { guard: extra.guard } : {}),
					// A step that ends `error` instead runs again: it saw nothing yet.
					...(written.ok && lasting && extra?.memory
						? { memory: extra.memory }
						: {}),
					...(shapes ? { shapes } : {}),
				},
			});
			if (shapes) await keepShapes(ctx, scope, node, shapes);
			changed();
			emit(config, {
				type: "step-ended",
				stepId,
				nodeId: node.id,
				visit,
				outcome,
			});
			return {
				stepId,
				visit,
				outcome,
				outputs,
				error,
				...(written.ok && extra?.guard ? { guard: extra.guard } : {}),
				...(extra?.harnessSessionId !== undefined
					? { harnessSessionId: extra.harnessSessionId }
					: {}),
				...(variables ? { variables } : {}),
			};
		},
		async endAndGo(outcome, outputs, error, more = {}) {
			const { update, trail, ...extra } = more;
			const next = climb
				? climbNext(climb, { outcome, outputs, error }, trail)
				: null;
			// A climbing try scores nothing: only the try that lands. A
			// stand-in scores nothing either: its data is an earlier step's.
			const scores =
				next || standIn ? [] : await dataScores(handle, node, outputs);
			const end = await handle.end(outcome, outputs, error, {
				...extra,
				...(next ? { skipWrites: true } : {}),
			});
			// After the end, as a Gate's answer: every reader sees the step ended first.
			for (const { score, value } of scores) {
				await ctx.log.append({
					type: "Scored",
					runId,
					stepId,
					payload: { score, value, label: null },
				});
			}
			if (climb && next) return climbCommand(climb.root, end, next);
			return route(ctx, state, node, end, config, update);
		},
		leaveOpen,
	};
	return { kind: "step", step: handle };
}

/**
 * The node's writes to its flow's variables for a step that ends with
 * `outcome` (`applyVariableWrites`): over the step's template context, with
 * the node's own outputs this step's, and a `json` variable held to its
 * schema.
 */
function writeVariables(
	ctx: StepContext,
	node: FlowNode,
	tctx: TemplateContext,
	outcome: StepOutcome,
	outputs: StepOutputs,
): Promise<VariableResult> | VariableResult {
	if (!node.set || node.set.length === 0) return { ok: true, values: {} };
	return applyVariableWrites({
		node,
		variables: ctx.flow.variables ?? [],
		outcome,
		context: { ...tctx, nodes: { ...tctx.nodes, [node.id]: outputs } },
		checkSchema: dataProblem,
	});
}

/** Whether a Device id the log names is `device` (this computer has two ids: its own and the Walker's). */
function isDevice(ctx: StepContext, id: string, device: Device): boolean {
	return ctx.placement.deviceById(id, ctx.run).id === device.id;
}

/** The run's worktree on `device`, from the log, or null when the run has none there. */
function worktreeOn(
	ctx: StepContext,
	runState: RunState,
	device: Device,
): string | null {
	for (const [id, path] of deriveWorktrees(runState, ctx.run).paths) {
		if (isDevice(ctx, id, device)) return path;
	}
	return null;
}

/**
 * What a step's Device must be before the body runs, or null when it is
 * ready. A step that needs a computer (`NodeKind.works`) moves to a
 * fallback that can take it (`StepPlacement.moveStep`, ADR 17), else
 * sleeps while its Device is offline (`device-offline`). A step that works in the worktree
 * of a run that has none yet (its Device was offline at the start) makes
 * it on the run's Device first, and sleeps while that Device is offline.
 * A step that works in the worktree on another Device than the one that has the
 * run's work gets it by a Hand-off first: the Device that has it pushes
 * the branch (a worktree with uncommitted changes fails the step: nothing
 * is committed for you), this one fetches it into its own worktree of the
 * run, and the Walker logs `HandedOff`. When the copy on the Device that
 * has the work is gone (the cleanup removes it a day after the run
 * ended), that Device makes it again first (`restoreRunCopy`, ADR 28).
 * A step that follows the work
 * (`NodeKind.followsWork`) needs none: `beginStep` placed it on the Device
 * that has the work, and it sleeps while that Device is offline. A run of
 * a project without a folder has no Hand-off: the step works in the run
 * folder of its own Device (`readyRunFolder`, ADR 22).
 */
export async function readyDevice(
	ctx: StepContext,
	node: FlowNode,
	step: OpenStep,
): Promise<BodyResult | null> {
	const works = ctx.kindOf(node).works(node);
	if (works === null) return null;
	const offline = (at: Device): BodyResult => ({
		kind: "offline",
		reason: "device-offline",
		deviceId: at.id,
		name: at.name,
	});
	if (!(await step.device.state()).online) {
		const moved = await ctx.placement.moveStep({
			log: ctx.log,
			node,
			run: ctx.run,
			stepId: step.stepId,
			from: step.device,
			hasSession: (step.existing?.sessions.length ?? 0) > 0,
			inWorktree: works === "worktree",
		});
		if (!moved) return offline(step.device);
		step.device = moved;
	}
	if (works !== "worktree") return null;
	const fail = (error: string): BodyResult => ({
		kind: "end",
		outcome: "error",
		outputs: { visit: step.visit },
		error,
	});
	const { device } = step;
	let runState = await ctx.log.state(ctx.run.id);
	if (runState.runFolder) {
		const notReady = await readyRunFolder(ctx, step, runState);
		if (notReady?.kind === "offline") return offline(notReady.at);
		if (notReady?.kind === "refused") {
			return fail(
				`${notReady.at.name} could not make the run's folder. ${stepFailure(notReady.error, `the run folder of run ${ctx.run.id}`)}`,
			);
		}
		return null;
	}
	const made = await makeRunWorktree(ctx, runState);
	if (made?.kind === "offline") return offline(made.at);
	if (made?.kind === "refused") {
		return fail(
			`${made.at.name} could not make the run's copy of the project. ${stepFailure(made.error, `the worktree of run ${ctx.run.id}`)}`,
		);
	}
	if (made?.kind === "made") {
		runState = await ctx.log.state(ctx.run.id);
		step.tctx.run.worktree = made.worktree.worktreePath;
		step.tctx.run.base_ref = made.worktree.baseRef;
		if (step.tctx.run.branch === "")
			step.tctx.run.branch = made.worktree.branch;
	}
	const { holder, paths } = deriveWorktrees(runState, ctx.run);
	// A resume or a rerun after the cleanup: the copy that has the work is made again first.
	const notBack = (at: Device, error: unknown): BodyResult =>
		fail(
			`${at.name} could not make the run's copy of the project again. ${stepFailure(error, `the worktree of run ${ctx.run.id}`)}`,
		);
	if (isDevice(ctx, holder, device)) {
		const cwd = paths.get(holder) ?? step.worktree;
		const back = await restoreRunCopy(ctx, device, cwd, runState);
		if (back.kind === "refused") return notBack(device, back.error);
		step.worktree = back.kind === "made" ? back.worktreePath : cwd;
		return null;
	}
	const from = ctx.placement.deviceById(holder, ctx.run);
	if (!(await from.state()).online) return offline(from);
	const cwd = paths.get(holder) ?? ctx.run.worktreePath;
	const back = await restoreRunCopy(ctx, from, cwd, runState);
	if (back.kind === "refused") return notBack(from, back.error);
	let sent: { commit: string; branch: string };
	try {
		sent = await from.handOff({
			cwd: back.kind === "made" ? back.worktreePath : cwd,
			runBranch: ctx.run.branch,
		});
	} catch (error) {
		return fail(
			`The run's work on ${from.name} cannot move to ${device.name}. ${stepFailure(error, `the hand-off of run ${ctx.run.id}`)}`,
		);
	}
	const author = ctx.run.startedBy
		? await ctx.gitAuthor(ctx.run.startedBy)
		: null;
	let worktree: { worktreePath: string };
	try {
		worktree = await device.receiveHandOff({
			run: {
				id: ctx.run.id,
				projectId: ctx.run.projectId,
				...(author ? { author } : {}),
			},
			branch: sent.branch,
			commit: sent.commit,
		});
	} catch (error) {
		return fail(
			`${device.name} could not take the run's work from ${from.name}. ${stepFailure(error, `the hand-off of run ${ctx.run.id}`)}`,
		);
	}
	await ctx.log.append({
		type: "HandedOff",
		runId: ctx.run.id,
		stepId: step.stepId,
		payload: {
			from: from.id,
			to: device.id,
			commit: sent.commit,
			branch: sent.branch,
			worktreePath: worktree.worktreePath,
		},
	});
	step.worktree = worktree.worktreePath;
	return null;
}

/**
 * `{{stack.log_tail}}` of a service that runs: the end of its log as it is
 * now, not as it was when the service got ready. Only the services of this
 * flow's scope, by their node.
 */
function withServiceTails(
	ctx: StepContext,
	tctx: TemplateContext,
	holds: readonly Hold[],
	scope: Scope | null,
): TemplateContext {
	const key = scopeKey(scope);
	let nodes: TemplateContext["nodes"] | null = null;
	for (const hold of holds) {
		if (hold.kind !== "service" || scopeKey(hold.scope) !== key) continue;
		const outputs = tctx.nodes[hold.nodeId];
		if (outputs === undefined) continue;
		nodes ??= { ...tctx.nodes };
		nodes[hold.nodeId] = {
			...outputs,
			log_tail: ctx.services.tail(hold.logPath),
		};
	}
	return nodes === null ? tctx : { ...tctx, nodes };
}
