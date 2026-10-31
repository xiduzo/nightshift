import { z } from "zod";
import { labelSchema, type NodeCheck, nodeBase } from "./base";
import { checkOptions, type Option, option } from "./outcomes";

/** The Wait node: it sleeps until a time, a command passes, or a signal arrives. */

/**
 * What a Wait node waits for. `duration`: a number of minutes. `time`: a
 * template that renders a date and time (`2026-10-18T07:00`, with an
 * optional zone) or a time of day (`07:00`: the next one on this computer's
 * clock). `command`: a command (`sh -c` in the worktree, template values as
 * environment variables, as in a Command node) run every `everyMinutes`
 * until it exits 0, or picks one of the node's `outcomes`. `signal`: a name someone sends to the run, or a webhook
 * schedule sends to the project's runs. With `key` (a template), only a
 * webhook signal whose key is the rendered text wakes it; a signal sent to
 * the run by its id always does.
 */
export const waitUntilSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("duration"),
		minutes: z.number().int().positive(),
	}),
	z.object({ kind: z.literal("time"), at: z.string().min(1) }),
	z.object({
		kind: z.literal("command"),
		command: z.string().min(1),
		everyMinutes: z.number().int().positive(),
	}),
	z.object({
		kind: z.literal("signal"),
		name: labelSchema,
		key: z.string().min(1).optional(),
	}),
]);
export type WaitUntil = z.infer<typeof waitUntilSchema>;

/**
 * Sleeps until a time, a command passes, or a signal arrives, then ends
 * `done`. `timeoutMinutes` bounds every kind: the step ends `timeout` when
 * it runs out. Outputs: `waited_minutes`, the last `log_tail` of a
 * command, the data the command wrote, and the `data` of the webhook that
 * sent the signal.
 *
 * `outcomes` (ADR 8): more ways out than `done`. A polled command picks
 * one: it writes `{ "outcome": "red" }` to `$NS_OUTPUT` and exits 0
 * (`commandWaitOutcome`). Without `outcomes`, the Wait works as before.
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
	if (until.kind === "signal" && until.key !== undefined)
		check.template(until.key, "key");
	if (until.kind === "command") {
		check.template(until.command, "command");
		if (
			node.timeoutMinutes !== undefined &&
			node.timeoutMinutes <= until.everyMinutes
		) {
			check.error(
				`Wait node "${node.id}" runs its command every ${until.everyMinutes} min but times out after ${node.timeoutMinutes} min. Give it a longer timeout than the interval.`,
			);
		}
	}
}

/**
 * A Wait's own outcomes: only on a wait that can pick one (a command),
 * each a valid, unique label that is not `done` or `timeout`. A command
 * picks by its data, not by a rule. One without an edge ends the run
 * there: a warning.
 */
function checkWaitOutcomes(node: WaitNode, check: NodeCheck): void {
	if (node.outcomes === undefined) return;
	if (node.until.kind !== "command") {
		check.error(
			`Wait node "${node.id}" lists outcomes, but only a command can pick one. Remove the outcomes, or wait for a command.`,
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
		if (outcome.when !== undefined) {
			check.error(
				`Wait node "${node.id}" has a rule on "${outcome.name}", but its command picks the outcome. Remove the rule.`,
			);
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
