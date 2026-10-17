import { Command, type LangGraphRunnableConfig } from "@langchain/langgraph";
import {
	renderCommand,
	renderTemplate,
	type WaitNode,
	type WaitUntil,
} from "@nightshift/flows";

import { runCommand, tailOf } from "../../command";
import type { StepOutputs } from "../../events";
import { commandLogPath } from "../../transcripts";
import {
	beginStep,
	messageOf,
	type NodeAction,
	STOP_TIME_REASON,
	type StepContext,
	type StepHandle,
	stopAtOf,
} from "../context";
import { parkCommand, route, type StepEnd, waitNodeId } from "../route";
import type { PendingWait, RunStateValues } from "../state";

/**
 * The Wait node: the first node whose whole job is the engine's park-and-wake
 * machinery. It opens its step, works out when to wake, appends
 * `WaitStarted`, records the transcript `wait` entry, leaves the step open
 * and jumps to its wait node (`wait__<id>`, the shared `waitNode`), which
 * interrupts; the runner schedules the wake timer from the interrupt and
 * rebuilds it after a restart from `WaitStarted`. A wake (the timer, a
 * person, or a signal) re-enters the node with `pending.kind === "wait"`,
 * which continues the same step and decides:
 *
 * - the stop time has passed: the step ends `stopped` and the run parks
 *   with the stop-time reason, as a new step would;
 * - the node's `timeoutMinutes` ran out: `timeout`;
 * - `duration` and `time`: `done` (a person who wakes it early skips the rest);
 * - `command`: the command runs again; exit 0 is `done`, else the step
 *   sleeps `everyMinutes` more and tries again;
 * - `signal`: `done` when the wake is that signal (`pending.signal`), else
 *   the step keeps waiting.
 *
 * The pending wait's streak carries what the node needs across its sleeps:
 * `since` is when the wait began (the deadline and `waited_minutes` count
 * from it) and `count` how many times it slept. A wake time past the
 * deadline is cut to it, so the timeout fires as a wake. Everything else
 * ends the step and routes (`route()`): `done`, `timeout`, `error` (a time
 * that does not parse, a command that cannot start) or `stopped`.
 *
 * A parked or interrupted Wait step has nothing to continue: a resume
 * starts the next visit, as a Command does.
 */
export function waitStepNode(node: WaitNode, ctx: StepContext): NodeAction {
	return async (state, config) => {
		const pending =
			state.pending?.kind === "wait" && state.pending.nodeId === node.id
				? state.pending
				: null;
		const begun = await beginStep(
			ctx,
			node,
			state,
			config,
			pending ? { kind: "continue", stepId: pending.stepId } : { kind: "new" },
		);
		if (begun.kind === "parked") return begun.command;
		const step = begun.step;

		try {
			const next = pending
				? await continueWait(ctx, node, step, state, config, pending)
				: await startWait(ctx, node, step);
			if (next.kind === "sleep") {
				return new Command({
					update: { pending: next.pending },
					goto: waitNodeId(node.id),
				});
			}
			if (next.kind === "stop-time") {
				return parkCommand({
					node,
					status: "stopped",
					reason: STOP_TIME_REASON,
					step: next.end,
					update: {
						nodes: { [node.id]: next.end.outputs },
						visits: { [node.id]: next.end.visit },
					},
				});
			}
			return route(ctx, state, node, next.end, config);
		} catch (error) {
			const end = await step.end(
				"error",
				{ outcome: "error", visit: step.visit },
				messageOf(error),
			);
			return route(ctx, state, node, end, config);
		}
	};
}

type Next =
	| { kind: "sleep"; pending: PendingWait }
	| { kind: "end"; end: StepEnd }
	| { kind: "stop-time"; end: StepEnd };

/** What the first visit does: work out the first wake time, or end at once. */
async function startWait(
	ctx: StepContext,
	node: WaitNode,
	step: StepHandle,
): Promise<Next> {
	const now = ctx.now();
	const until = node.until;
	const deadline = deadlineOf(node, now, ctx.minuteMs);
	const outputs: StepOutputs = { visit: step.visit, waited_minutes: 0 };
	switch (until.kind) {
		case "duration":
			return sleep(ctx, node, step, {
				since: now,
				count: 0,
				until: now + until.minutes * ctx.minuteMs,
				deadline,
				message: `Waits ${until.minutes} min.`,
			});
		case "time": {
			const text = renderTemplate(until.at, step.tctx).trim();
			const at = parseTime(text, now);
			if (at === null) {
				return {
					kind: "end",
					end: await step.end(
						"error",
						{ ...outputs, outcome: "error" },
						`The time "${text}" is not valid. Write a date and time like 2026-10-18T07:00, or a time like 07:00.`,
					),
				};
			}
			return sleep(ctx, node, step, {
				since: now,
				count: 0,
				until: at,
				deadline,
				message: `Waits until ${new Date(at).toISOString()}.`,
			});
		}
		case "command": {
			const polled = await poll(ctx, step, until, outputs);
			if (polled.kind === "end") return polled;
			return sleep(ctx, node, step, {
				since: now,
				count: 0,
				until: now + until.everyMinutes * ctx.minuteMs,
				deadline,
				message: `The command did not pass yet. Tries again in ${until.everyMinutes} min.`,
				logTail: polled.logTail,
			});
		}
		case "signal":
			return sleep(ctx, node, step, {
				since: now,
				count: 0,
				until: null,
				deadline,
				message: `Waits for the signal "${until.name}".`,
				signal: until.name,
			});
	}
}

/** What a wake does: end the wait, or sleep again. */
async function continueWait(
	ctx: StepContext,
	node: WaitNode,
	step: StepHandle,
	state: RunStateValues,
	config: LangGraphRunnableConfig,
	pending: PendingWait,
): Promise<Next> {
	const now = ctx.now();
	const until = node.until;
	const since = pending.streak.since;
	const deadline = deadlineOf(node, since, ctx.minuteMs);
	const waited = Math.round((now - since) / ctx.minuteMs);
	const outputs: StepOutputs = { visit: step.visit, waited_minutes: waited };
	// A command wait that ends without a fresh try keeps the last output it gave.
	if (until.kind === "command") outputs.log_tail = await lastTail(ctx, step);
	const end = (
		outcome: "done" | "timeout" | "stopped",
		extra: StepOutputs = {},
	) => step.end(outcome, { ...outputs, ...extra, outcome }, null);

	// A stop between the wake and the node's entry ends the step there.
	const aborted = step.abortResult(outputs);
	if (aborted) {
		return {
			kind: "end",
			end: await step.end(aborted.outcome, aborted.outputs, aborted.error),
		};
	}
	// Past the stop time, no step continues: the run parks as a new step would.
	const stopAt = stopAtOf(state, config);
	if (stopAt !== null && now >= stopAt) {
		return { kind: "stop-time", end: await end("stopped") };
	}
	if (until.kind === "signal" && pending.signal === until.name) {
		return { kind: "end", end: await end("done") };
	}
	if (deadline !== null && now >= deadline) {
		return { kind: "end", end: await end("timeout") };
	}
	switch (until.kind) {
		case "duration":
		case "time":
			return { kind: "end", end: await end("done") };
		case "command": {
			const polled = await poll(ctx, step, until, outputs);
			if (polled.kind === "end") return polled;
			return sleep(ctx, node, step, {
				since,
				count: pending.streak.count,
				until: now + until.everyMinutes * ctx.minuteMs,
				deadline,
				message: `The command did not pass yet. Tries again in ${until.everyMinutes} min.`,
				logTail: polled.logTail,
			});
		}
		case "signal":
			// A timer or a person woke it before the signal came: keep waiting.
			return sleep(ctx, node, step, {
				since,
				count: pending.streak.count,
				until: null,
				deadline,
				message: `Waits for the signal "${until.name}".`,
				signal: until.name,
			});
	}
}

/**
 * Runs the command once, as a Command node does: template values as
 * environment variables, output to the transcript and the step's log file.
 * Exit 0 ends the step `done`; a kill or a stop ends it as the signal says;
 * a command that cannot start ends it `error`. Any other exit means wait.
 */
async function poll(
	ctx: StepContext,
	step: StepHandle,
	until: Extract<WaitUntil, { kind: "command" }>,
	outputs: StepOutputs,
): Promise<{ kind: "end"; end: StepEnd } | { kind: "wait"; logTail: string }> {
	const { command, env } = renderCommand(until.command, step.tctx);
	step.record(null, { type: "command-start", command });
	const result = await runCommand({
		command,
		cwd: ctx.run.worktreePath,
		env,
		logPath: commandLogPath(ctx.dataDir, ctx.run.id, step.stepId),
		signal: step.signal,
		onOutput: (stream, text) =>
			step.record(null, { type: "command-output", stream, text }),
	});
	step.record(null, { type: "command-exit", exitCode: result.exitCode });
	const withTail: StepOutputs = { ...outputs, log_tail: result.logTail };
	const aborted = step.abortResult(withTail);
	if (aborted) {
		return {
			kind: "end",
			end: await step.end(aborted.outcome, aborted.outputs, aborted.error),
		};
	}
	if (result.spawnError) {
		return {
			kind: "end",
			end: await step.end(
				"error",
				{ ...withTail, outcome: "error" },
				`The command could not start: ${result.spawnError}`,
			),
		};
	}
	if (result.exitCode === 0) {
		return {
			kind: "end",
			end: await step.end("done", { ...withTail, outcome: "done" }, null),
		};
	}
	return { kind: "wait", logTail: result.logTail };
}

/**
 * Appends `WaitStarted`, records the transcript `wait` entry, tells the bus
 * and leaves the step open, as `beginWait` does for the run policy. The wake
 * time is cut to the deadline, so the timeout fires as a wake. Returns the
 * pending wait the node jumps to its wait node with.
 */
async function sleep(
	ctx: StepContext,
	node: WaitNode,
	step: StepHandle,
	plan: {
		since: number;
		/** Earlier sleeps of this step. */
		count: number;
		until: number | null;
		deadline: number | null;
		message: string;
		signal?: string;
		logTail?: string;
	},
): Promise<Next> {
	const until =
		plan.deadline === null
			? plan.until
			: plan.until === null
				? plan.deadline
				: Math.min(plan.until, plan.deadline);
	const signal = plan.signal !== undefined ? { signal: plan.signal } : {};
	await ctx.log.append({
		type: "WaitStarted",
		runId: ctx.run.id,
		stepId: step.stepId,
		payload: {
			reason: node.until.kind,
			until,
			message: plan.message,
			since: plan.since,
			...signal,
		},
	});
	step.record(null, {
		type: "wait",
		reason: node.until.kind,
		until,
		message: plan.message,
		...signal,
	});
	ctx.bus.publish(ctx.run.id, { kind: "step-changed", stepId: step.stepId });
	step.leaveOpen();
	return {
		kind: "sleep",
		pending: {
			kind: "wait",
			stepId: step.stepId,
			nodeId: node.id,
			visit: step.visit,
			harnessSessionId: null,
			prompt: "",
			reason: node.until.kind,
			until,
			message: plan.message,
			resetAt: null,
			streak: { count: plan.count + 1, since: plan.since },
		},
	};
}

/** The tail of the step's log file: every try of the command, appended. */
async function lastTail(ctx: StepContext, step: StepHandle): Promise<string> {
	const file = Bun.file(commandLogPath(ctx.dataDir, ctx.run.id, step.stepId));
	return (await file.exists()) ? tailOf(await file.text()) : "";
}

/** When the node's time budget runs out, counted from when the wait began. */
function deadlineOf(
	node: WaitNode,
	since: number,
	minuteMs: number,
): number | null {
	return node.timeoutMinutes === undefined
		? null
		: since + node.timeoutMinutes * minuteMs;
}

const CLOCK_TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/**
 * A rendered `time` wait: a date and time (`2026-10-18T07:00`, with an
 * optional zone, as `Date.parse` reads it) or a time of day (`07:00`, the
 * next such time on this computer's clock). Null when it is neither.
 */
export function parseTime(text: string, now: number): number | null {
	const clock = CLOCK_TIME.exec(text);
	if (clock) {
		const next = new Date(now);
		next.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
		if (next.getTime() <= now) next.setDate(next.getDate() + 1);
		return next.getTime();
	}
	if (!/\d{4}-\d{2}-\d{2}/.test(text)) return null;
	const parsed = Date.parse(text);
	return Number.isNaN(parsed) ? null : parsed;
}
