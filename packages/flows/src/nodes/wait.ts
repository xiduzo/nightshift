import { z } from "zod";
import { labelSchema, type NodeCheck, nodeBase } from "./base";
import { checkOptions, type Option, option } from "./outcomes";

/** The Wait node: it sleeps until a time, a command passes, or a signal arrives. */

/** A command a Wait runs every `everyMinutes`. */
const waitCommandFields = {
	command: z.string().min(1),
	everyMinutes: z.number().int().positive(),
};

/** A signal a Wait waits for, with an optional key. */
const waitSignalFields = {
	name: labelSchema,
	key: z.string().min(1).optional(),
};

/**
 * What a Wait node waits for. `duration`: a number of minutes. `time`: a
 * template that renders a date and time (`2026-10-18T07:00`, with an
 * optional zone) or a time of day (`07:00`: the next one on this computer's
 * clock). `command`: a command (`sh -c` in the worktree, template values as
 * environment variables, as in a Command node) run every `everyMinutes`
 * until it exits 0, or picks one of the node's `outcomes`. `signal`: a
 * name someone sends to the run, or a webhook schedule sends to the
 * project's runs. With `key` (a template), only a webhook signal whose key
 * is the rendered text wakes it; a signal sent to the run by its id always
 * does. `any`: a signal and a command, whichever ends the wait first, such
 * as a webhook with a command every 10 minutes as a backup.
 */
export const waitUntilSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("duration"),
		minutes: z.number().int().positive(),
	}),
	z.object({ kind: z.literal("time"), at: z.string().min(1) }),
	z.object({ kind: z.literal("command"), ...waitCommandFields }),
	z.object({ kind: z.literal("signal"), ...waitSignalFields }),
	z.object({
		kind: z.literal("any"),
		signal: z.object(waitSignalFields),
		command: z.object(waitCommandFields),
	}),
]);
export type WaitUntil = z.infer<typeof waitUntilSchema>;

/** The command a Wait polls: its own, or the one of an `any` wait. */
export type WaitCommand = { command: string; everyMinutes: number };
/** The signal a Wait waits for: its own, or the one of an `any` wait. */
type WaitSignal = { name: string; key?: string };

/** The command the Wait polls, or null when it polls none. */
export function waitCommandOf(until: WaitUntil): WaitCommand | null {
	if (until.kind === "command") return until;
	if (until.kind === "any") return until.command;
	return null;
}

/** The signal the Wait waits for, or null when it waits for none. */
export function waitSignalOf(until: WaitUntil): WaitSignal | null {
	if (until.kind === "signal") return until;
	if (until.kind === "any") return until.signal;
	return null;
}

/**
 * Sleeps until a time, a command passes, or a signal arrives, then ends
 * `done`. `timeoutMinutes` bounds every kind: the step ends `timeout` when
 * it runs out. Outputs: `waited_minutes`, the last `log_tail` of a
 * command, the data the command wrote, and the `data` of the webhook that
 * sent the signal.
 *
 * `outcomes` (ADR 8): more ways out than `done`. A polled command picks
 * one: it writes `{ "outcome": "red" }` to `$NS_OUTPUT` and exits 0
 * (`commandWaitOutcome`). A signal picks one by rule: the first outcome
 * whose `when` (JSONata over `event`, the signal's data) holds. A webhook
 * signal that matches no rule does not wake the Wait. Without `outcomes`,
 * the Wait works as before.
 */
export const waitNodeSchema = z.object({
	...nodeBase,
	type: z.literal("wait"),
	until: waitUntilSchema,
	outcomes: z.array(option).min(1).optional(),
});
export type WaitNode = z.infer<typeof waitNodeSchema>;

/** The outcomes a Wait always has besides its own: a Wait cannot list these. */
export const WAIT_OUTCOMES = ["done", "timeout"] as const;

/** A Wait node's own outcomes, in order: none when it lists none. */
export function waitOutcomes(node: Pick<WaitNode, "outcomes">): Option[] {
	return node.outcomes ?? [];
}

/**
 * The rules a signal picks an outcome by, in order: the Wait's outcomes
 * that have a `when`. Empty: any signal of the name ends the wait `done`.
 */
export function signalRules(
	node: Pick<WaitNode, "outcomes">,
): { outcome: string; when: string }[] {
	return waitOutcomes(node).flatMap((outcome) =>
		outcome.when === undefined || outcome.when.trim() === ""
			? []
			: [{ outcome: outcome.name, when: outcome.when }],
	);
}

/** Whether `outcome` is one of the Wait's own outcomes, not `done` or `timeout`. */
export function isOwnWaitOutcome(
	node: Pick<WaitNode, "outcomes">,
	outcome: string,
): boolean {
	return waitOutcomes(node).some((own) => own.name === outcome);
}

/**
 * What one try of a polled command means for the wait. `outcome`: the
 * wait ends there (one of its own outcomes, or `done`). `again`: it polls
 * again, with why. Exit 0 and data whose `outcome` the Wait lists: that
 * outcome. Exit 0 and no outcome: `done`. Exit not 0, or an outcome the
 * Wait does not list (`pending`): again.
 */
export function commandWaitOutcome(
	node: Pick<WaitNode, "outcomes">,
	exitCode: number | null,
	data: unknown,
): { kind: "outcome"; outcome: string } | { kind: "again"; picked?: string } {
	if (exitCode !== 0) return { kind: "again" };
	const picked =
		typeof data === "object" && data !== null && !Array.isArray(data)
			? (data as Record<string, unknown>).outcome
			: undefined;
	if (typeof picked !== "string") return { kind: "outcome", outcome: "done" };
	if (isOwnWaitOutcome(node, picked)) {
		return { kind: "outcome", outcome: picked };
	}
	// A Wait without outcomes keeps today's rule: exit 0 is done.
	if (node.outcomes === undefined) return { kind: "outcome", outcome: "done" };
	return { kind: "again", picked };
}

/** waited_minutes: how long the step waited. log_tail: the last output of a command it waited on. data: the JSON the command wrote to `$NS_OUTPUT`, or the webhook event (`{ body, headers }`) that sent its signal. */
export const waitOutputFields = [
	"outcome",
	"waited_minutes",
	"log_tail",
	"data",
	"visit",
] as const;

/**
 * A Wait node's templates (the time, the command, the key) read known names, and a
 * command that runs every `everyMinutes` needs a timeout longer than that:
 * a shorter one times out before the second try. Its own outcomes follow
 * the outcome rules (`checkWaitOutcomes`).
 */
export function checkWaitNode(node: WaitNode, check: NodeCheck): void {
	const until = node.until;
	checkWaitOutcomes(node, check);
	if (until.kind === "time") check.template(until.at, "time");
	const signal = waitSignalOf(until);
	if (signal?.key !== undefined) check.template(signal.key, "key");
	const polled = waitCommandOf(until);
	if (polled) {
		check.template(polled.command, "command");
		if (
			node.timeoutMinutes !== undefined &&
			node.timeoutMinutes <= polled.everyMinutes
		) {
			check.error(
				`Wait node "${node.id}" runs its command every ${polled.everyMinutes} min but times out after ${node.timeoutMinutes} min. Give it a longer timeout than the interval.`,
			);
		}
	}
}

/**
 * A Wait's own outcomes: only on a wait that can pick one (a command, a
 * signal or both), each a valid, unique label that is not `done` or
 * `timeout`. A command picks by its data, so on a command wait an outcome
 * takes no rule. A signal picks by rule: each rule is valid and reads only
 * `event`, and on a signal wait an outcome without one is never picked.
 * On an `any` wait, the command picks any outcome and the signal picks the
 * ones with a rule. One without an edge ends the run there: a warning.
 */
function checkWaitOutcomes(node: WaitNode, check: NodeCheck): void {
	if (node.outcomes === undefined) return;
	const kind = node.until.kind;
	if (kind === "duration" || kind === "time") {
		check.error(
			`Wait node "${node.id}" lists outcomes, but only a command or a signal can pick one. Remove the outcomes, or wait for a command or a signal.`,
		);
		return;
	}
	const names = waitOutcomes(node).map((outcome) => outcome.name);
	const builtIn: readonly string[] = WAIT_OUTCOMES;
	for (const outcome of waitOutcomes(node)) {
		if (builtIn.includes(outcome.name)) {
			check.error(
				`Wait node "${node.id}" lists the outcome "${outcome.name}", which every Wait has. Give it another name.`,
			);
		}
		const when = outcome.when?.trim() ?? "";
		if (kind === "command" && when !== "") {
			check.error(
				`Wait node "${node.id}" has a rule on "${outcome.name}", but its command picks the outcome. Remove the rule.`,
			);
		} else if (kind === "signal" && when === "") {
			check.warning(
				`Wait node "${node.id}" has no rule for "${outcome.name}": a signal never ends the wait there. Give it a rule.`,
			);
		} else if (when !== "") {
			check.eventRule(when, `The rule of "${outcome.name}" of "${node.id}"`);
		}
	}
	checkOptions(
		node.id,
		names.filter((name) => !builtIn.includes(name)),
		{ title: "Wait", kind: "outcome", picker: "the wait ends on" },
		() => false,
		check,
	);
}
