import { z } from "zod";
import { nodeBase } from "./base";
import {
	type BuiltInOutcome,
	type NodeDefinition,
	noEndedLabel,
	noOwnColors,
	noSecrets,
	type Position,
	takesNoValue,
} from "./definition";

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

/** A new Join node: it waits for every branch until the person picks `first`. */
export function joinNode(id: string, position: Position): JoinNode {
	return { id, type: "join", position, wait: "all" };
}

/** The Join node type. */
export const joinDefinition = {
	type: "join",
	label: "Join",
	family: "compose",
	// It waits for its branches (ADR 27).
	standsIn: false,
	outcomes: () => ["done"] satisfies BuiltInOutcome[],
	outcomeColor: noOwnColors,
	outputFields: joinOutputFields,
	// A Join's checks are the branches' (`checkBranches`).
	check: () => {},
	texts: [],
	plain: [],
	secrets: noSecrets,
	endsFlow: (_node, outcome) => outcome === "done",
	endedLabel: noEndedLabel,
	touchesDevice: () => false,
	typedOutputField: () => null,
	mainOutputField: () => "data",
	newNodes: { join: { id: "join", takes: "nothing", create: joinNode } },
	takeValue: takesNoValue,
	sample: {
		id: "reviewed",
		type: "join",
		position: { x: 0, y: 0 },
		wait: "all",
	},
} satisfies NodeDefinition<JoinNode, z.input<typeof joinNodeSchema>>;
