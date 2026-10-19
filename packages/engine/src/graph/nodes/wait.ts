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
	endedAtReason,
	type NodeAction,
	type NodeKind,
	PLAIN_KIND,
	type StepContext,
} from "../context";
import { RESUME_RULES } from "../resume-point";
import { type OwnWait, pendingWaitOf } from "../sleep";
import type { PendingWait } from "../state";
import { type BodyResult, runStep, type StepHandle } from "../step-runner";

/**
 * The Wait node: the first node whose whole job is the engine's park-and-wake
 * machinery. Its body works out when to wake and returns the sleep module
 * an `OwnWait` (`{ kind: "sleep" }`): the sleep module appends
 * `WaitStarted`, records the transcript `wait` entry, leaves the step open
 * and parks at the node's wait node (`wait__<id>`), which interrupts; the
 * runner schedules the wake timer from the interrupt and rebuilds it after
 * a restart from `WaitStarted`. A wake (the timer, a person, or a signal)
 * re-enters the node with its pending wait, which continues the same step
 * and decides:
 *
 * - the stop time has passed: the step runner ends the step `stopped` and
 *   parks the run with the stop-time reason, as a new step would, with the
 *   `waited_minutes` the node gives it;
 * - the node's `timeoutMinutes` ran out: `timeout`;
 * - `duration` and `time`: `done` (a person who wakes it early skips the rest);
 * - `command`: the command runs again; exit 0 is `done`, else the step
 *   sleeps `everyMinutes` more and tries again;
 * - `signal`: `done` when the wake is that signal (`pending.signal`), else
 *   the step keeps waiting.
 *
 * The pending wait's streak carries what the node needs across its sleeps:
 * `since` is when the wait began (the deadline and `waited_minutes` count
 * from it) and `count` how many times it slept. The sleep module cuts a
 * wake time past the deadline to it, so the timeout fires as a wake.
 * Everything else ends the step, and the runner routes: `done`, `timeout`,
 * `error` (a time that does not parse, a command that cannot start) or
 * `stopped`.
 *
 * A parked or interrupted Wait step has nothing to continue: a resume
 * starts the next visit, as a Command does (`RESUME_RULES.wait`: only the
 * pending wait's step is taken up).
 */
export function waitStepNode(node: WaitNode, ctx: StepContext): NodeAction {
	return (state, config) => {
		const pending = pendingWaitOf(state.pending, node.id);
		return runStep(ctx, node, state, config, {
			rules: WAIT.resumeRules(node),
			// A step that ends at its wake before the node spoke (the stop time
			// passed) still says how long it waited.
			outputs: (step) =>
				pending
					? waitedOutputs(ctx, node, step, pending)
					: { visit: step.visit },
			body: (step) =>
				pending
					? continueWait(ctx, node, step, pending)
					: startWait(ctx, node, step),
		});
	};
}

/**
 * The Wait kind. A wait node for its own sleeps; `done` is its chosen end
 * (`timeout` a failure); no step timer, as the node keeps its own deadline
 * across its sleeps; a command poll writes the command log.
 */
export const WAIT: NodeKind<WaitNode> = {
	...PLAIN_KIND,
	type: "wait",
	make: waitStepNode,
	works: (node) => (node.until.kind === "command" ? "worktree" : null),
	resumeRules: () => RESUME_RULES.wait,
	aux: () => [{ kind: "wait" }],
	isChosenEnd: (_node, outcome) => outcome === "pass" || outcome === "done",
	endReason: (node, outcome) =>
		outcome === "pass" || outcome === "done"
			? null
			: endedAtReason(node, outcome),
	logsCommandOutput: (node) => node.until.kind === "command",
	timeBudget: () => ({ timeoutMinutes: undefined, idleMinutes: undefined }),
};

/** The outputs of a wake: how long the step waited, and a command wait's last output. */
async function waitedOutputs(
	ctx: StepContext,
	node: WaitNode,
	step: StepHandle,
	pending: PendingWait,
): Promise<StepOutputs> {
	const waited = Math.round((ctx.now() - pending.streak.since) / ctx.minuteMs);
	const outputs: StepOutputs = { visit: step.visit, waited_minutes: waited };
	// A command wait that ends without a fresh try keeps the last output it gave.
	if (node.until.kind === "command")
		outputs.log_tail = await lastTail(ctx, step);
	return outputs;
}

/** What the first visit does: work out the first wake time, or end at once. */
async function startWait(
	ctx: StepContext,
	node: WaitNode,
	step: StepHandle,
): Promise<BodyResult> {
	const now = ctx.now();
	const until = node.until;
	const deadline = deadlineOf(node, now, ctx.minuteMs);
	const outputs: StepOutputs = { visit: step.visit, waited_minutes: 0 };
	switch (until.kind) {
		case "duration":
			return sleep(node, {
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
					outcome: "error",
					outputs,
					error: `The time "${text}" is not valid. Write a date and time like 2026-10-18T07:00, or a time like 07:00.`,
				};
			}
			return sleep(node, {
				until: at,
				deadline,
				message: `Waits until ${new Date(at).toISOString()}.`,
			});
		}
		case "command": {
			const polled = await poll(ctx, step, until, outputs);
			if (polled.kind !== "again") return polled;
			return sleep(node, {
				until: now + until.everyMinutes * ctx.minuteMs,
				deadline,
				message: `The command did not pass yet. Tries again in ${until.everyMinutes} min.`,
			});
		}
		case "signal":
			return sleep(node, {
				until: null,
				deadline,
				message: `Waits for the signal "${until.name}".`,
				signal: until.name,
			});
	}
}

/**
 * What a wake does: end the wait, or sleep again. The stop time was checked
 * by the step runner before the node entered (a continued step past it
 * ends `stopped` with `waitedOutputs`).
 */
async function continueWait(
	ctx: StepContext,
	node: WaitNode,
	step: StepHandle,
	pending: PendingWait,
): Promise<BodyResult> {
	const now = ctx.now();
	const until = node.until;
	const since = pending.streak.since;
	const deadline = deadlineOf(node, since, ctx.minuteMs);
	const outputs = await waitedOutputs(ctx, node, step, pending);
	const end = (outcome: "done" | "timeout"): BodyResult => ({
		kind: "end",
		outcome,
		outputs,
		error: null,
	});

	// A stop between the wake and the node's entry ends the step there.
	if (step.signal.aborted) return { kind: "aborted", outputs };
	if (until.kind === "signal" && pending.signal === until.name) {
		return end("done");
	}
	if (deadline !== null && now >= deadline) return end("timeout");
	switch (until.kind) {
		case "duration":
		case "time":
			return end("done");
		case "command": {
			const polled = await poll(ctx, step, until, outputs);
			if (polled.kind !== "again") return polled;
			return sleep(node, {
				until: now + until.everyMinutes * ctx.minuteMs,
				deadline,
				message: `The command did not pass yet. Tries again in ${until.everyMinutes} min.`,
			});
		}
		case "signal":
			// A timer or a person woke it before the signal came: keep waiting.
			return sleep(node, {
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
): Promise<BodyResult | { kind: "again"; logTail: string }> {
	const { command, env } = renderCommand(until.command, step.tctx);
	step.record(null, { type: "command-start", command });
	const result = await runCommand(step.device, {
		command,
		cwd: step.worktree,
		env,
		logPath: commandLogPath(ctx.dataDir, ctx.run.id, step.stepId),
		signal: step.signal,
		onOutput: (stream, text) =>
			step.record(null, { type: "command-output", stream, text }),
	});
	step.record(null, { type: "command-exit", exitCode: result.exitCode });
	const withTail: StepOutputs = { ...outputs, log_tail: result.logTail };
	if (step.signal.aborted) return { kind: "aborted", outputs: withTail };
	if (result.spawnError) {
		return {
			kind: "end",
			outcome: "error",
			outputs: withTail,
			error: `The command could not start: ${result.spawnError}`,
		};
	}
	if (result.exitCode === 0) {
		return { kind: "end", outcome: "done", outputs: withTail, error: null };
	}
	return { kind: "again", logTail: result.logTail };
}

/**
 * Asks the sleep module to sleep: it plans the wake (cut to the deadline),
 * appends `WaitStarted`, records the transcript `wait` entry and parks at
 * the wait node with the step open. The streak (when the wait began, how
 * often it slept) is the sleep module's to keep.
 */
function sleep(node: WaitNode, wait: Omit<OwnWait, "reason">): BodyResult {
	return { kind: "sleep", reason: node.until.kind, ...wait };
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
