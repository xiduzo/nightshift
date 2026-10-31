import { z } from "zod";
import {
	calledFlowNameSchema,
	labelSchema,
	type NodeCheck,
	nameSchema,
	nodeBase,
	placed,
	reservedOutcomes,
} from "./base";
import {
	checkCascade,
	isPersonTier,
	personTierSchema,
	RETRY_CHOICES,
	tierBase,
	tierLabel,
} from "./cascade";

/**
 * The Call node: it runs another flow of the project, once or once per
 * element of a list (`each`). The checks that need the called flow (it
 * exists, takes the bindings, does not call back) are flow checks.
 */

/** A template string per input name of the called flow. */
const bindings = z.record(nameSchema, z.string());

/**
 * A template that renders a JSON array, often another node's output:
 * `{{planner.data.tasks}}`. A template that is one reference keeps the
 * value as it is; any other text is parsed as JSON after rendering.
 */
export const jsonSourceSchema = z.object({
	kind: z.literal("json"),
	value: z.string().min(1),
});

/**
 * A command (sh -c in the worktree) that prints a JSON array. Template
 * values arrive as environment variables, as in a Command node. An issue
 * tracker is a command on its CLI: `gh`, `glab`, `acli`.
 */
export const commandSourceSchema = z.object({
	kind: z.literal("command"),
	command: z.string().min(1),
});

export const listSourceSchema = z.discriminatedUnion("kind", [
	jsonSourceSchema,
	commandSourceSchema,
]);
export type ListSource = z.infer<typeof listSourceSchema>;

/**
 * How a Call node runs its flow once per element of a list. An element is
 * any JSON value. An object element may carry `id` (else `name`, else its
 * position), `title`, `url`, `dependsOn` (ids, or `{ id, done }`), and
 * `done` (true: skipped).
 */
export const callEachSchema = z.object({
	/** Read again before each element, so elements added during the run run too. */
	source: listSourceSchema,
	/** The input of the called flow that receives the element. */
	as: nameSchema.default("item"),
	/**
	 * `per-item`: each element works on its own branch, created on top of the
	 * last element that finished (the stack). `shared`: all elements work on
	 * the branch that is checked out.
	 */
	branch: z.enum(["per-item", "shared"]).default("per-item"),
	/** A called flow that ends on one of these options stops the loop with `halted`. */
	haltOn: z.array(labelSchema).default(["halt"]),
	/** Safety net: the most elements one visit may start. */
	maxItems: z.number().int().positive().optional(),
});
export type CallEach = z.infer<typeof callEachSchema>;

/**
 * A tier of a Call's cascade (ADR 6): a flow of the project or a kit, and
 * its inputs. Unset: the node's flow. On the node's flow its inputs add to
 * the node's; another flow takes only the tier's own. They may read
 * `{{cascade.previous}}`. A try holds when the called flow ends `pass`.
 */
/** A tier of a Call's cascade. Named, so the declared types stay small. */
export interface CallTier {
	label?: string;
	tries?: number;
	flow?: string;
	inputs?: Record<string, string>;
}

export const callTierSchema: z.ZodType<CallTier> = z.object({
	...tierBase,
	flow: calledFlowNameSchema.optional(),
	inputs: bindings.optional(),
});

/**
 * Runs another flow of the project, or a kit (`kitFlow`): once, or once per element of a list
 * with `each`. `inputs` binds each input of the called flow to a template
 * (with `each`, the element goes to the input named by `each.as`).
 *
 * Once: ends `pass` or `fail`; its outputs are the called flow's outputs,
 * plus `ended` (the label or choice it ended on, or "") and `visit`. A
 * called flow that ends at an End node ends the Call `pass` (`done`,
 * `nothing-to-do`) or `fail` (`failed`); `ended` is then the End's status
 * and `end_message` its message.
 * With `each`: ends `done` or `halted`; its outputs count the elements and
 * hold each one's result in `results` (`callEachOutputFields`).
 *
 * Either way it ends `stopped` when the run's stop time comes while it runs.
 * Without an edge on `stopped` the run stops there, as anywhere. With one,
 * the run goes on along it, and the nodes after it run past the stop time:
 * they wrap the night up (a report, a stack of pull requests). The element
 * that was running ends `failed`. The run then finishes, it cannot be resumed.
 *
 * `device` names the computer its steps run on (its Placement, as on a
 * Command), whatever computer runs the rest of the run: a folder that
 * exists on one computer only. A node inside that names its own Device,
 * or a profile, keeps it. Unset: each step runs where it would anyway.
 */
export const callNodeSchema = z.object({
	...nodeBase,
	...placed,
	type: z.literal("call"),
	/** A flow file of the project by name, or a kit: `kit:github/create-branch`. */
	flow: calledFlowNameSchema,
	inputs: bindings.default({}),
	each: callEachSchema.optional(),
	/**
	 * Without `each` only: the flows the Call climbs (ADR 6). Each tier's
	 * flow is tried up to its `tries`, then the next tier's. The last tier
	 * can be a person: a Gate with "try-again" and "stop". To climb over a
	 * group of nodes, make the group a flow.
	 */
	cascade: z
		.array(z.union([personTierSchema, callTierSchema]))
		.min(1)
		.max(8)
		.optional(),
});
export type CallNode = z.infer<typeof callNodeSchema>;

/** Every flow a Call node may run: its own, then each tier's of its cascade. */
export function calledFlowNames(node: CallNode): string[] {
	const names = [node.flow];
	for (const tier of node.cascade ?? []) {
		if (isPersonTier(tier) || tier.flow === undefined) continue;
		if (!names.includes(tier.flow)) names.push(tier.flow);
	}
	return names;
}
/** A Call node with `each`: it runs its flow once per element. */
export type CallEachNode = CallNode & { each: CallEach };

/**
 * Without `each`. ended: the label or choice the called flow ended on, or
 * the status of its End node, or "". end_message: the message of that End
 * node, or "".
 */
export const callOutputFields = [
	"outcome",
	"ended",
	"end_message",
	"visit",
] as const;

/**
 * The fields of a Call node with `each`: counts per element state; summary:
 * one line per element; results: a JSON array of `{ id, title, state,
 * reason, outputs }` per element.
 */
export const callEachOutputFields = [
	"outcome",
	"done_count",
	"failed_count",
	"blocked_count",
	"waiting_count",
	"summary",
	"results",
	"visit",
] as const;

/** A Call node's templates (the list source, the bindings) read known names, and its halt labels are valid. */
export function checkCallNode(node: CallNode, check: NodeCheck): void {
	const each = node.each;
	if (each !== undefined) {
		switch (each.source.kind) {
			case "json":
				check.template(each.source.value, "source value");
				break;
			case "command":
				check.template(each.source.command, "source command");
				break;
		}
		checkHaltOn(node.id, each, check);
	}
	for (const [name, value] of Object.entries(node.inputs)) {
		check.template(value, `input "${name}"`);
	}
	checkCallCascade(node, check);
}

/** A Call's cascade runs its flows once each: not with `each`. Its tiers' inputs read known names. */
function checkCallCascade(node: CallNode, check: NodeCheck): void {
	const tiers = node.cascade;
	if (tiers === undefined) return;
	if (node.each !== undefined) {
		check.error(
			`Subflow node "${node.id}" has a cascade and runs its flow for each element. A cascade climbs one run of a flow. Remove the cascade, or the list.`,
		);
		return;
	}
	checkCascade(node, { title: "Subflow", personChoices: RETRY_CHOICES }, check);
	tiers.forEach((tier, index) => {
		if (isPersonTier(tier)) return;
		const label = tierLabel(tier, index);
		for (const [name, value] of Object.entries(tier.inputs ?? {})) {
			check.template(value, `input "${name}" of the tier "${label}"`);
		}
	});
}

/** Halt labels are outcomes of the called flow: valid labels, not reserved. */
function checkHaltOn(nodeId: string, each: CallEach, check: NodeCheck): void {
	const reserved: readonly string[] = reservedOutcomes;
	for (const label of each.haltOn) {
		const parsed = labelSchema.safeParse(label);
		if (!parsed.success) {
			check.error(
				`Subflow node "${nodeId}" halts on "${label}", which is not a valid label: ${parsed.error.issues[0]?.message ?? "not allowed"}`,
			);
		} else if (reserved.includes(label)) {
			check.error(
				`Subflow node "${nodeId}" halts on "${label}", which is reserved. Do not use: ${reserved.join(", ")}.`,
			);
		}
	}
}
