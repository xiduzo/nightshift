import { Command, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { CostSource } from "@nightshift/agents/pricing";
import type { FlowNode } from "@nightshift/flows";
import type {
	RunState,
	RunWarningKind,
	StepOutcome,
	StepOutputs,
} from "../../log";
import { type Climb, climbCommand, climbNext } from "../cascade";
import {
	pastStopTime,
	STOP_TIME_REASON,
	type StepContext,
	stepFailure,
} from "../context";
import { type DoneStep, positionOf } from "../position";
import {
	askNodeId,
	parkFailed,
	parkStopped,
	route,
	routeDone,
	type StepEnd,
	scopeOf,
} from "../route";
import type {
	CascadeTry,
	PendingGate,
	RunStateUpdate,
	RunStateValues,
} from "../state";
import { abortEnd } from "./abort";
import { beginStep } from "./begin-step";
import { openGate } from "./gate";
import { readyDevice } from "./ready-device";
import { entryOf, resumePoint } from "./resume-point";
import { withLoggedWorktree } from "./run-worktree";
import { type SleepRequest, sleep } from "./sleep";
import { type ChangesWatch, watchChanges } from "./step-changes";
import type {
	AbortReason,
	BodyResult,
	EndExtra,
	GuardReason,
	OpenStep,
	StepSpec,
	StepStart,
} from "./step-handle";

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
 * lifecycle lands in this folder. Leverage: one table test
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
 * The lifecycle is in this folder, along its steps: `runStep` here, the seam
 * in `step-handle.ts`, the open and the close of a step in `begin-step.ts`,
 * the Device a step works on in `ready-device.ts`, and the end of an aborted
 * step in `abort.ts`.
 */

/** The run warning each guard lands, and the stall guard's (`idle`). */
const GUARD_WARNINGS = {
	budget: "budget",
	turns: "turns",
	looping: "looping",
	idle: "stalled",
} as const satisfies Record<GuardReason | "idle", RunWarningKind>;

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
	if (entry.kind === "new") await endLost(ctx, node, state, runState, config);
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
		return parkStopped(node, end, {
			reason: STOP_TIME_REASON,
			endReason: "stop_time",
		});
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
					...(result.handOffFailed
						? { handOffFailed: result.handOffFailed }
						: {}),
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
				return parkFailed(
					node,
					{ ...end, guard: "budget" },
					aborted.error ?? "",
					extra,
				);
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
				const { reason, endReason } = slept;
				return parkStopped(node, end, { reason, endReason });
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
			return endAndGo("error", await blank("error"), slept.error, {
				...costs,
				...(slept.endReason ? { endReason: slept.endReason } : {}),
			});
		}
	}
}

/**
 * Ends the step of the node that the log still has open and no checkpoint
 * knows, before a new visit takes its place: it slept, and the daemon died
 * before the thread held its wait.
 */
async function endLost(
	ctx: StepContext,
	node: FlowNode,
	state: RunStateValues,
	runState: RunState,
	config: LangGraphRunnableConfig,
): Promise<void> {
	const lost = positionOf(state, runState, scopeOf(config)).uncommitted(node);
	if (!lost || lost.endedAt !== null) return;
	const outcome = "interrupted";
	await ctx.log.append({
		type: "StepEnded",
		runId: ctx.run.id,
		stepId: lost.id,
		payload: {
			outcome,
			outputs: ctx.kindOf(node).cutShortOutputs(lost, node, outcome),
			error: "Night Shift stopped while this ran.",
		},
	});
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
