import { z } from "zod";
import { labelSchema, nameSchema, nodeIdSchema } from "../names";
import type { NodeText } from "./texts";

/**
 * The parts every node type shares: JSON values, variable writes, the
 * base fields of a node and what its check reports to. The names of a
 * flow, the Device a step runs on and the deciders have their own files.
 * It imports no node type, so each node file and the flow format can
 * import it without a cycle.
 */

/** A JSON Schema object (draft 2020-12 subset), kept as data. */
export const jsonSchemaSchema = z.record(z.string(), z.unknown());

/**
 * Marks a node's `output` schema that Night Shift inferred from a real
 * output: no person wrote or confirmed it. A template path it lacks is a
 * warning, and a run does not fail on it. Unset: a person wrote or
 * confirmed the schema. An edit or a confirm in the editor removes it.
 */
export const outputInferredSchema = z.literal(true).optional();

/** A JSON Schema for an object: `type: "object"`, or `properties`. */
export function isObjectSchema(schema: Record<string, unknown>): boolean {
	return (
		schema.type === "object" ||
		(typeof schema.properties === "object" && schema.properties !== null)
	);
}

/** Any JSON value: what inputs, outputs and list elements hold. */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

const position = z.object({ x: z.number(), y: z.number() });

/**
 * One write of a node to a variable of its flow, applied once when the
 * node's step ends (`set` on every node). Exactly one of `value` and
 * `expression` (the validator checks it). The node's own id reads the step
 * that just ended. A step that ends `stopped`, `error` or `interrupted`
 * writes nothing.
 */
export const variableWriteSchema = z.object({
	/** The variable, by name. */
	variable: nameSchema,
	/** A template: `{{deliver.data.url}}`. One reference keeps its JSON value. */
	value: z.string().optional(),
	/** A JSONata expression over the run's values, `vars` included: `vars.tries + 1`. */
	expression: z.string().optional(),
	/** The outcomes that write. Unset: every outcome the step routes on. */
	on: z.array(labelSchema).optional(),
});
export type VariableWrite = z.infer<typeof variableWriteSchema>;

/**
 * How long a run holds what a node takes for a scope: a lease (ADR 7) or a
 * service (ADR 9). `run` (the default): until the run ends. `{ section }`:
 * until the run leaves the Section with that id, which holds the node. A
 * Section, here, only marks where the scope ends. An object, not a bare
 * id: a Section may be called "run".
 */
export const holdScopeSchema = z.union([
	z.literal("run"),
	z.object({ section: z.string().min(1) }),
]);

export const nodeBase = {
	id: nodeIdSchema,
	/** Display name in the editor. Defaults to the id. */
	label: z.string().optional(),
	position,
	/** Wall-clock budget for one visit. The step fails when it runs out. */
	timeoutMinutes: z.number().int().positive().optional(),
	/** Writes to the flow's variables when the step ends, in order. */
	set: z.array(variableWriteSchema).optional(),
};

/**
 * The texts of `nodeBase` (`NodeDefinition.texts`): the value and the
 * expression of each variable write, after the node's own texts.
 */
export const nodeBaseTexts: readonly NodeText[] = [
	{ at: "set[].value", self: true },
	{ at: "set[].expression", kind: "rule", self: true },
];

/** The plain text of `nodeBase` (`NodeDefinition.plain`). */
export const nodeBasePlain: readonly string[] = ["label"];

/**
 * What the check of one node reports to and reads through. The flow check
 * (`validateFlow`) makes one per node. Every issue lands on that node.
 */
export type NodeCheck = {
	error: (message: string) => void;
	warning: (message: string) => void;
	/** Checks the references of a template. `where` names its field: "prompt". */
	template: (text: string, where: string) => void;
	/** The same for a shell command, which also warns of a value the shell cannot fill in. */
	commandTemplate: (text: string, where: string) => void;
	/**
	 * Checks that a rule (a JSONata expression) is valid and reads known
	 * names. `subject` starts each message: `The expression of "pick"`.
	 * `also`: the names the rule reads besides the flow's (`previous`).
	 */
	rule: (expr: string, subject: string, also?: readonly string[]) => void;
	/**
	 * Checks that a rule over a signal's data (`event.body.action`) is valid
	 * and reads only `event`. `subject` starts each message.
	 */
	eventRule: (expr: string, subject: string) => void;
	/**
	 * Checks that a rule over a value a model made (`data.tasks`) is valid
	 * and reads only `data`: the `accept` rule of a cascade tier.
	 */
	dataRule: (expr: string, subject: string) => void;
	/** Whether an edge leaves the node on this outcome. */
	routed: (outcome: string) => boolean;
	/**
	 * Every node in the Section `id` of the flow, at any depth, or null
	 * when the flow has no such Section.
	 */
	section: (id: string) => readonly string[] | null;
};
