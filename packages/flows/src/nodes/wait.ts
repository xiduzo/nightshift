import { z } from "zod";
import { labelSchema, type NodeCheck, nodeBase } from "./base";

/** The Wait node: it sleeps until a time, a command passes, or a signal arrives. */

/**
 * What a Wait node waits for. `duration`: a number of minutes. `time`: a
 * template that renders a date and time (`2026-10-18T07:00`, with an
 * optional zone) or a time of day (`07:00`: the next one on this computer's
 * clock). `command`: a command (`sh -c` in the worktree, template values as
 * environment variables, as in a Command node) run every `everyMinutes`
 * until it exits 0. `signal`: a name someone sends to the run.
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
	z.object({ kind: z.literal("signal"), name: labelSchema }),
]);
export type WaitUntil = z.infer<typeof waitUntilSchema>;

/**
 * Sleeps until a time, a command passes, or a signal arrives, then ends
 * `done`. `timeoutMinutes` bounds every kind: the step ends `timeout` when
 * it runs out. Outputs: `waited_minutes`, and the last `log_tail` of a
 * command.
 */
export const waitNodeSchema = z.object({
	...nodeBase,
	type: z.literal("wait"),
	until: waitUntilSchema,
});
export type WaitNode = z.infer<typeof waitNodeSchema>;

/** waited_minutes: how long the step waited. log_tail: the last output of a command it waited on. */
export const waitOutputFields = [
	"outcome",
	"waited_minutes",
	"log_tail",
	"visit",
] as const;

/**
 * A Wait node's templates (the time, the command) read known names, and a
 * command that runs every `everyMinutes` needs a timeout longer than that:
 * a shorter one times out before the second try.
 */
export function checkWaitNode(node: WaitNode, check: NodeCheck): void {
	const until = node.until;
	if (until.kind === "time") check.template(until.at, "time");
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
