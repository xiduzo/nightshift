import { z } from "zod";
import { nodeBase } from "./base";

/**
 * The Join node: where the parallel branches of a fan-out meet again.
 *
 * Several edges that leave one node on one outcome without a `max` run all
 * at once (a fan-out, `flow/branches.ts`). Every branch ends at the
 * same Join. `all` (the default) goes on once every branch arrived; `first`
 * goes on with the first branch that arrives and stops the others. A Join
 * ends `done`.
 */
export const joinWaitSchema = z.enum(["all", "first"]);
export type JoinWait = z.infer<typeof joinWaitSchema>;

export const joinNodeSchema = z.object({
	...nodeBase,
	type: z.literal("join"),
	/** `all`: wait for every branch. `first`: go on with the first that arrives, and stop the others. */
	wait: joinWaitSchema.default("all"),
});
export type JoinNode = z.infer<typeof joinNodeSchema>;

/**
 * data: an object keyed by the id of the node each branch entered the Join
 * from, holding that step's `data` (null when it has none). With `first`
 * it holds the first branch only.
 */
export const joinOutputFields = ["outcome", "data", "visit"] as const;
