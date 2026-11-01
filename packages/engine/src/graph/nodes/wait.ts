import {
	commandWaitOutcome,
	isOwnWaitOutcome,
	type JsonValue,
	renderCommand,
	renderTemplate,
	signalOutcome,
	signalRules,
	type WaitCommand,
	type WaitNode,
	waitCommandOf,
	waitSignalOf,
} from "@nightshift/flows";
import { iso, nextClockTime, parseInstant } from "@nightshift/time";

import { runCommand, tailOf } from "../../device";
import { commandLogPath, type StepOutputs } from "../../log";
import {
	endedAtReason,
	type NodeAction,
	type NodeKind,
	PLAIN_KIND,
	type StepContext,
} from "../context";
import { RESUME_RULES } from "../resume-point";
import { heldStep } from "../run-position";
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
 * - `command`: the command runs again; exit 0 is `done`, or the outcome
 *   its data picks from the node's `outcomes` (`commandWaitOutcome`), else
 *   the step sleeps `everyMinutes` more and tries again;
 * - `signal`: `done` when the wake is that signal (`pending.signal`), with
 *   the event of the webhook that sent it as `data`; else the step keeps
 *   waiting. A `key` is rendered when the wait starts and logged with it
 *   (`WaitStarted.signalKey`): the webhook signals match on it
 *   (`run/signals.ts`). With rules on its outcomes (`signalRules`, logged
 *   as `WaitStarted.signalRules`), a webhook's signal ends the wait on the
 *   first outcome whose rule holds, and one that matches none keeps it
 *   waiting. A person's signal brings no event: it ends `done`.
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
		const pending = pendingWaitOf(heldStep(state, node.id));
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
 * The Wait kind. A wait node for its own sleeps; `done` and its own
 * outcomes are its chosen ends (`timeout` a failure); no step timer, as the
 * node keeps its own deadline across its sleeps; a command poll writes the
 * command log.
 */
export const WAIT: NodeKind<WaitNode> = {
	...PLAIN_KIND,
	type: "wait",
	make: waitStepNode,
	works: (node) => (waitCommandOf(node.until) ? "worktree" : null),
	resumeRules: () => RESUME_RULES.wait,
	aux: () => [{ kind: "wait" }],
	isChosenEnd: (node, outcome) =>
		outcome === "pass" || outcome === "done" || isOwnWaitOutcome(node, outcome),
	endReason: (node, outcome) =>
		outcome === "pass" || outcome === "done"
			? null
			: endedAtReason(node, outcome),
	endedLabel: (node, outcome) =>
		isOwnWaitOutcome(node, outcome) ? outcome : "",
	logsCommandOutput: (node) => waitCommandOf(node.until) !== null,
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
	if (waitCommandOf(node.until)) outputs.log_tail = await lastTail(ctx, step);
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
				message: `Waits until ${iso(at)}.`,
			});
		}
		default:
			return pollOrWait(ctx, node, step, outputs, deadline);
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
	const end = (outcome: string): BodyResult => ({
		kind: "end",
		outcome,
		outputs,
		error: null,
	});

	// A stop between the wake and the node's entry ends the step there.
	if (step.signal.aborted) return { kind: "aborted", outputs };
	const signal = waitSignalOf(until);
	if (signal && pending.signal === signal.name) {
		const data = pending.signalData;
		const picked = await signalPick(node, data);
		if (picked !== null) {
			// A webhook's signal brings its event: the step's data.
			if (data !== undefined) outputs.data = data;
			return end(picked);
		}
		if (deadline === null || now < deadline) {
			// The signal matched no rule: wait on, and poll when it was due.
			const polled = waitCommandOf(until);
			const due =
				polled === null
					? null
					: pending.until !== null && pending.until > now
						? pending.until
						: now + polled.everyMinutes * ctx.minuteMs;
			return sleep(node, ownWait(ctx, node, step, deadline, due, null));
		}
	}
	if (deadline !== null && now >= deadline) return end("timeout");
	switch (until.kind) {
		case "duration":
		case "time":
			return end("done");
		default:
			// A timer or a person woke it: poll the command, if it has one.
			return pollOrWait(ctx, node, step, outputs, deadline);
	}
}

/**
 * The outcome a signal picks: the first outcome whose rule holds over its
 * event (`signalRules`), `done` when the node has no rules, or null when
 * none holds. A person's signal brings no event, so no rule reads it: it
 * ends `done`.
 */
async function signalPick(
	node: WaitNode,
	data: JsonValue | undefined,
): Promise<string | null> {
	const rules = signalRules(node);
	if (data === undefined || rules.length === 0) return "done";
	return signalOutcome(rules, data);
}

/**
 * A wait on a command, a signal or both (`any`): polls the command now, if
 * it has one, and ends when the command ends the wait. Else it sleeps until
 * the next poll, or until the signal comes, whichever is first.
 */
async function pollOrWait(
	ctx: StepContext,
	node: WaitNode,
	step: StepHandle,
	outputs: StepOutputs,
	deadline: number | null,
): Promise<BodyResult> {
	const polled = waitCommandOf(node.until);
	if (polled === null) {
		return sleep(node, ownWait(ctx, node, step, deadline, null, null));
	}
	const result = await poll(ctx, node, step, polled, outputs);
	if (result.kind !== "again") return result;
	const due = ctx.now() + polled.everyMinutes * ctx.minuteMs;
	return sleep(node, ownWait(ctx, node, step, deadline, due, result));
}

/**
 * The sleep of a wait on a command, a signal or both. `due`: when the
 * command runs again (null: it has none). The signal's key is rendered
 * now, so a webhook's signal is matched against the run's own values, and
 * the rules of its outcomes go with it, so one that matches none does not
 * wake the run. `again`: why the last poll did not end the wait.
 */
function ownWait(
	ctx: StepContext,
	node: WaitNode,
	step: StepHandle,
	deadline: number | null,
	due: number | null,
	again: Again | null,
): Omit<OwnWait, "reason"> {
	const signal = waitSignalOf(node.until);
	const parts: string[] = [];
	let signalFields: Pick<OwnWait, "signal" | "signalKey" | "signalRules"> = {};
	if (signal) {
		const key =
			signal.key === undefined
				? undefined
				: renderTemplate(signal.key, step.tctx).trim();
		const rules = signalRules(node);
		parts.push(
			key === undefined
				? `Waits for the signal "${signal.name}".`
				: `Waits for the signal "${signal.name}" with the key "${key}".`,
		);
		signalFields = {
			signal: signal.name,
			...(key === undefined ? {} : { signalKey: key }),
			...(rules.length === 0 ? {} : { signalRules: rules }),
		};
	}
	if (due !== null) {
		const minutes = Math.max(1, Math.ceil((due - ctx.now()) / ctx.minuteMs));
		parts.push(againMessage(again, minutes));
	}
	return {
		until: due,
		deadline,
		message: parts.join(" "),
		...signalFields,
	};
}

/** Why a poll did not end the wait. */
type Again = {
	kind: "again";
	logTail: string;
	/** An outcome the command picked that the node does not list. */
	picked?: string;
	/** The data the command wrote is not valid JSON. */
	notJson?: boolean;
};

/** What the wait says when it polls again. */
function againMessage(again: Again | null, everyMinutes: number): string {
	if (again?.notJson) {
		return `The data the command wrote is not valid JSON. Tries again in ${everyMinutes} min.`;
	}
	if (again?.picked !== undefined) {
		return `The command picked "${again.picked}", which is not an outcome of this Wait. Tries again in ${everyMinutes} min.`;
	}
	return `The command did not pass yet. Tries again in ${everyMinutes} min.`;
}

/**
 * Runs the command once, as a Command node does: template values as
 * environment variables, output to the transcript and the step's log file,
 * a new file for its data in `$NS_OUTPUT`. JSON written there is the
 * step's `data`. Exit 0 ends the step `done`, or on the outcome the data
 * picks (`commandWaitOutcome`); a kill or a stop ends it as the signal
 * says; a command that cannot start ends it `error`. Anything else means
 * wait.
 */
async function poll(
	ctx: StepContext,
	node: WaitNode,
	step: StepHandle,
	until: WaitCommand,
	outputs: StepOutputs,
): Promise<BodyResult | Again> {
	const { command, env } = renderCommand(until.command, step.tctx);
	step.record(null, { type: "command-start", command });
	const result = await runCommand(step.device, {
		command,
		cwd: step.worktree,
		env,
		outputFile: true,
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
	const written = result.output?.trim() ?? "";
	if (written !== "") {
		try {
			withTail.data = JSON.parse(written) as JsonValue;
		} catch {
			// Without outcomes, the exit code decides, as before.
			if (node.outcomes !== undefined) {
				return { kind: "again", logTail: result.logTail, notJson: true };
			}
		}
	}
	const picked = commandWaitOutcome(node, result.exitCode, withTail.data);
	if (picked.kind === "outcome") {
		return {
			kind: "end",
			outcome: picked.outcome,
			outputs: withTail,
			error: null,
		};
	}
	return {
		kind: "again",
		logTail: result.logTail,
		...(picked.picked === undefined ? {} : { picked: picked.picked }),
	};
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
 * optional zone) or a time of day (`07:00`, the next such time on this
 * computer's clock). Null when it is neither.
 */
export function parseTime(text: string, now: number): number | null {
	const clock = CLOCK_TIME.exec(text);
	if (clock) return nextClockTime(now, Number(clock[1]), Number(clock[2]));
	if (!/\d{4}-\d{2}-\d{2}/.test(text)) return null;
	const parsed = parseInstant(text);
	return Number.isNaN(parsed) ? null : parsed;
}
