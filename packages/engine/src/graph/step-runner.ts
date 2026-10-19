import { randomUUID } from "node:crypto";
import type { Command, LangGraphRunnableConfig } from "@langchain/langgraph";
import type { CostSource } from "@nightshift/agents/pricing";
import {
	agentSession,
	step as stepTable,
} from "@nightshift/db/schema/nightshift";
import type { FlowNode, TemplateContext } from "@nightshift/flows";
import { eq } from "drizzle-orm";
import type { Device } from "../device/types";
import {
	countStepsSinceWalkBegan,
	countVisits,
	type DerivedStep,
	deriveSteps,
	deriveStopAfterStep,
	type EnginePayloads,
	type LoggedEvent,
	type RunWarningKind,
	type StepOutputs,
	scopeKey,
} from "../events";
import { commandLogPath, transcriptPath } from "../transcripts";
import type { StepEvent, StepOutcome } from "../types";
import {
	emit,
	messageOf,
	pastStopTime,
	STOP_AFTER_STEP_REASON,
	STOP_TIME_REASON,
	type StepContext,
	stopAtOf,
	templateContext,
} from "./context";
import { kindOf } from "./node-kinds";
import {
	entryOf,
	type ResumePoint,
	type ResumeRules,
	resumePoint,
} from "./resume-point";
import {
	parkCommand,
	parkStopped,
	route,
	type StepEnd,
	scopeOf,
} from "./route";
import {
	type OwnWait,
	type SleepRequest,
	sleep,
	type WaitRequest,
} from "./sleep";
import type { RunStateValues } from "./state";

/**
 * The step runner: one deep module that owns the lifecycle every step node
 * shares, behind one small interface, `runStep(ctx, node, state, config,
 * spec)`. A node module keeps only its body: what happens between
 * `StepStarted` and the step's end. The runner decides how the node enters
 * (`resumePoint`), runs the entry checks of a new visit, writes the `step`
 * row and the step's log events, opens the transcript and the timers,
 * translates an abort into the step's outcome, catches what the body
 * throws, hands a wait to the sleep module (`sleep()`, called from here
 * only) and routes on the end (`route()`).
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
 */

/** Why a step's signal aborted. */
export type AbortReason = "stopped" | "timeout" | "idle";

/**
 * How a node enters: a new visit (the default), or an existing step of the
 * node: `reopen` appends `StepReopened` (a person resumed a parked step, or
 * the daemon re-runs the node after a restart); `continue` appends nothing
 * (the step waited, and the wait ended). A `quiet` continue also tells the
 * bus and the custom stream nothing: the step did not start again (a Gate
 * that ends on its answer).
 */
export type StepStart =
	| { kind: "new" }
	| { kind: "reopen"; stepId: string; prompt: string | null }
	| { kind: "continue"; stepId: string; quiet?: boolean };

/** One harness session of an Agent step, as the runner records it. */
export type SessionRecord = {
	id: string;
	/** The harness named its session: the row and `HarnessSessionAssigned`. */
	assigned(harnessSessionId: string, model: string | null): Promise<void>;
	/** `SessionEnded` with how the session ended. */
	ended(payload: EnginePayloads["SessionEnded"]): Promise<void>;
};

/** A step in progress: what a node body reads and records. */
export type StepHandle = {
	stepId: string;
	visit: number;
	/** The Device the step runs on: the body's one way to touch a computer. */
	device: Device;
	/** The step as the log had it, for a reopened or continued step; null for a new visit. */
	existing: DerivedStep | null;
	/** The log as read on entry, before this step's own events. */
	events: readonly LoggedEvent[];
	tctx: TemplateContext;
	/** The step's own signal: a stop of the run, the node's time budget, or no activity for too long. */
	signal: AbortSignal;
	/** Writes one transcript entry (on disk, on the bus, on the custom stream). */
	record(sessionId: string | null, event: StepEvent): void;
	/** Resets the idle clock (Agent nodes with `idleMinutes`). */
	touch(): void;
	/**
	 * Starts a harness session of this step: the `agent_session` row,
	 * `SessionStarted`, the bus. The body records the rest through the
	 * returned record, so no node touches the database.
	 */
	session(start: EnginePayloads["SessionStarted"]): Promise<SessionRecord>;
	/** Logs a warning about this step (`RunWarned`): it did not fail, but a person should know. */
	warn(kind: RunWarningKind, message: string): Promise<void>;
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
	 * the returned end (`route()`).
	 */
	end(
		outcome: StepOutcome,
		outputs: StepOutputs,
		error: string | null,
		extra?: {
			costUsd?: number | null;
			costSource?: CostSource | null;
			harnessSessionId?: string | null;
		},
	): Promise<StepEnd>;
	/** Closes the recorder and the timers but leaves the step open in the log (a wait). */
	leaveOpen(): void;
};

/** What `beginStep` gives: a step to run, or the run parked before it. */
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
 *   ends when the wait would pass the stop time or the grace is spent.
 * - `sleep`: a Wait node worked out its own wake time (`OwnWait`); the
 *   sleep module persists it and parks at the wait node, the step open.
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
	| ({ kind: "sleep" } & OwnWait);

/** What a node tells the runner: how it re-enters, what its body does, what an empty end looks like. */
export type StepSpec = {
	/** Which existing step the node takes up again (`RESUME_RULES`). */
	rules: ResumeRules;
	/**
	 * The body: the node's own work, from `StepStarted` to its end. `entry`
	 * says how the step was entered, with the prompt and the harness session
	 * a continued or reopened step carries.
	 */
	body(step: StepHandle, entry: ResumePoint): Promise<BodyResult>;
	/**
	 * The outputs of a step that ends before its body spoke (the wait ended
	 * past the stop time, the body threw, a wait gave up): the visit and the
	 * kind's empty fields. Default `{ visit }`.
	 */
	outputs?(step: StepHandle): StepOutputs | Promise<StepOutputs>;
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
	const events = await ctx.log.events(ctx.run.id);
	const entry = resumePoint(node, state, events, scopeOf(config), spec.rules);
	const begun = await beginStep(
		ctx,
		node,
		state,
		config,
		entryOf(entry),
		events,
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
	try {
		result = await spec.body(step, entry);
	} catch (error) {
		result = {
			kind: "end",
			outcome: "error",
			outputs: await blank("error"),
			error: messageOf(error),
		};
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
	switch (result.kind) {
		case "end": {
			const end = await step.end(
				result.outcome,
				{ ...result.outputs, outcome: result.outcome },
				result.error,
				extraOf(result),
			);
			return route(ctx, state, node, end, config);
		}
		case "aborted": {
			const aborted = abortEnd(node, step.signal, result.outputs);
			const end = await step.end(
				aborted.outcome,
				aborted.outputs,
				aborted.error,
				extraOf(result),
			);
			return route(ctx, state, node, end, config);
		}
		case "wait":
		case "sleep": {
			const request: SleepRequest =
				result.kind === "wait"
					? { ...result, kind: "policy" }
					: { ...result, kind: "own" };
			const slept = await sleep(ctx, node, state, config, step, request);
			if (slept.kind === "asleep") return slept.command;
			// The step ends before its wait: with the session it has, and
			// what the decider cost before it hit the limit.
			const extra = result.kind === "wait" ? extraOf(result) : {};
			if (slept.kind === "stop-time") {
				const end = await step.end(
					"stopped",
					await blank("stopped"),
					null,
					extra,
				);
				return parkStopped(node, end, slept.reason);
			}
			const end = await step.end(
				"error",
				await blank("error"),
				slept.error,
				extra,
			);
			return route(ctx, state, node, end, config);
		}
	}
}

/**
 * The end an aborted step has, from its signal's reason: `error` with why
 * for the node's time budget or no activity, else `stopped` (a person
 * stopped the run). The outputs the body had so far are kept.
 */
export function abortEnd(
	node: FlowNode,
	signal: AbortSignal,
	outputs: StepOutputs,
): Pick<StepEnd, "outcome" | "outputs" | "error"> {
	const reason = signal.reason as AbortReason | undefined;
	if (reason === "timeout" || reason === "idle") {
		return {
			outcome: "error",
			outputs: { ...outputs, outcome: "error" },
			error:
				reason === "timeout"
					? `The step ran past its time budget of ${node.timeoutMinutes} min.`
					: `No activity for ${kindOf(node).timeBudget(node).idleMinutes} min.`,
		};
	}
	return {
		outcome: "stopped",
		outputs: { ...outputs, outcome: "stopped" },
		error: null,
	};
}

/**
 * Opens a step of `node` and returns what the node needs. For a new visit
 * it first runs the walk's entry checks, in this order, and parks the run
 * when one fires: a stop of the run (stopped, no reason), a stop after the
 * running step, the stop time (both stopped, with today's reasons), and the
 * step cap (failed, with today's reason). A continued or reopened step skips
 * them all: it is already in the log, and a stop must end it there (the old
 * walk had no entry check for one). It then writes the `step` row and
 * `StepStarted` (with the transcript path, the command log path and the
 * scope), or `StepReopened` for a reopen, and opens the transcript and the
 * timers. Exactly `runStep`'s scaffolding in the old engine. It asks
 * `ctx.deviceFor` for the step's Device first; `StepStarted` names it.
 *
 * `events` is the log as the caller read it on entry; without it the log
 * is read here.
 */
export async function beginStep(
	ctx: StepContext,
	node: FlowNode,
	state: RunStateValues,
	config: LangGraphRunnableConfig,
	start: StepStart = { kind: "new" },
	events?: readonly LoggedEvent[],
): Promise<BeginStep> {
	const runId = ctx.run.id;
	const scope = scopeOf(config);
	const key = scopeKey(scope);
	// Asked once per step: the body works on this Device, and a new step
	// records it.
	const device = ctx.deviceFor(node, ctx.run);
	const logged = events ?? (await ctx.log.events(runId));
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
		// Only a new visit parks before its step: a continued or reopened step
		// enters the node body with the aborted signal, so it ends `stopped`
		// with its session and a later resume can reopen it.
		if (ctx.signal().aborted) return parked("stopped", null);
		if (deriveStopAfterStep(logged)) {
			return parked("stopped", STOP_AFTER_STEP_REASON);
		}
		const stopAt = stopAtOf(state, config);
		if (stopAt !== null && ctx.now() >= stopAt) {
			return parked("stopped", STOP_TIME_REASON, true);
		}
		const limit = ctx.policy().maxSteps ?? ctx.settings().maxStepsPerRun;
		if (countStepsSinceWalkBegan(logged) >= limit) {
			return parked(
				"failed",
				`The run reached the limit of ${limit} steps before node "${node.id}". Resume it to continue.`,
			);
		}
		stepId = randomUUID();
		path = transcriptPath(ctx.dataDir, runId, stepId);
		visit = countVisits(logged, node.id, key) + 1;
		const logPath = kindOf(node).logsCommandOutput(node)
			? commandLogPath(ctx.dataDir, runId, stepId)
			: null;
		await ctx.db.insert(stepTable).values({
			id: stepId,
			spaceId: ctx.run.spaceId,
			runId,
			nodeId: node.id,
			nodeType: node.type,
			visit,
			transcriptPath: path,
			// The Device the step runs on (its Placement), not the Walker.
			deviceId: device.id,
		});
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
				deviceId: device.id,
			},
		});
	} else {
		existing = deriveSteps(logged).find((s) => s.id === start.stepId) ?? null;
		if (!existing) throw new Error(`Step not found: ${start.stepId}`);
		stepId = existing.id;
		path = existing.transcriptPath;
		visit = existing.visit;
		if (start.kind === "reopen") {
			await ctx.log.append({
				type: "StepReopened",
				runId,
				stepId,
				payload: { prompt: start.prompt },
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

	const recorder = await ctx.recorder(stepId, path);

	// The step's own signal: a stop of the run, the node's time budget, or
	// no activity for too long.
	const stepController = new AbortController();
	const runSignal = ctx.signal();
	const onStop = () => stepController.abort("stopped" satisfies AbortReason);
	if (runSignal.aborted) onStop();
	else runSignal.addEventListener("abort", onStop, { once: true });
	// The kind says which timers a step has: a Gate waits as long as it
	// must, a Wait node keeps its own deadline across its sleeps, and only an
	// Agent step has an idle clock.
	const { timeoutMinutes, idleMinutes } = kindOf(node).timeBudget(node);
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

	let closed = false;
	const leaveOpen = () => {
		if (closed) return;
		closed = true;
		recorder.close();
		clearTimeout(timer);
		clearTimeout(idleTimer);
		runSignal.removeEventListener("abort", onStop);
	};

	const handle: OpenStep = {
		stepId,
		visit,
		device,
		existing,
		events: logged,
		tctx: templateContext(ctx, state, config),
		signal: stepController.signal,
		opened: start.kind,
		record(sessionId, stepEvent) {
			const entry = recorder.record(sessionId, stepEvent);
			emit(config, { type: "transcript", entry });
		},
		touch,
		async warn(kind, message) {
			await ctx.log.append({
				type: "RunWarned",
				runId,
				stepId,
				payload: { kind, message },
			});
			changed();
		},
		async session(started) {
			const sessionId = randomUUID();
			await ctx.db.insert(agentSession).values({
				id: sessionId,
				spaceId: ctx.run.spaceId,
				runId,
				stepId,
				prompt: started.prompt,
			});
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
					await ctx.db
						.update(agentSession)
						.set({ harnessSessionId })
						.where(eq(agentSession.id, sessionId));
					await ctx.log.append({
						type: "HarnessSessionAssigned",
						runId,
						stepId,
						sessionId,
						payload: { harnessSessionId, model },
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
		async end(outcome, outputs, error, extra) {
			leaveOpen();
			await ctx.log.append({
				type: "StepEnded",
				runId,
				stepId,
				payload: {
					outcome,
					outputs,
					error,
					...(extra?.costUsd !== undefined ? { costUsd: extra.costUsd } : {}),
					...(extra?.costSource !== undefined
						? { costSource: extra.costSource }
						: {}),
				},
			});
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
				...(extra?.harnessSessionId !== undefined
					? { harnessSessionId: extra.harnessSessionId }
					: {}),
			};
		},
		leaveOpen,
	};
	return { kind: "step", step: handle };
}
