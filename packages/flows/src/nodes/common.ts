import { z } from "zod";

/**
 * The parts every node type shares: names, labels, deciders, the Device a
 * step runs on, variable writes and the base fields of a node. A leaf: it
 * imports no other node file, so each node file and the flow document can
 * import it without a cycle.
 */

/**
 * A node id, an input name or a variable name. Node ids and inputs are names
 * in templates (`{{check.log_tail}}`, `{{epic}}`) and share one namespace per
 * flow. Variables are read under `vars` (`{{vars.tries}}`). `run` and `vars`
 * are reserved.
 */
export const nameSchema = z
	.string()
	.regex(
		/^[a-z][a-z0-9_]{0,39}$/,
		"Use lowercase letters, digits and _, starting with a letter.",
	);
export const nodeIdSchema = nameSchema;

/** A flow file name, without `.json`. */
export const flowNameSchema = z
	.string()
	.regex(
		/^[a-z0-9][a-z0-9-]{0,59}$/,
		"Use lowercase letters, digits and -, starting with a letter or digit.",
	);

/**
 * An outcome: `pass`, `fail`, `needs-input`, an Agent's own outcome, or a
 * Decision option. "error", "stopped", "interrupted" and "waiting" are
 * reserved for the engine.
 */
export const labelSchema = z
	.string()
	.regex(
		/^[a-z][a-z0-9-]{0,29}$/,
		"Use lowercase letters, digits and -, starting with a letter.",
	);

export const reservedOutcomes = [
	"error",
	"stopped",
	"interrupted",
	"waiting",
] as const;

/** Names a flow may not use for a node, an input or a variable. */
export const reservedNames = ["run", "vars"] as const;

/**
 * Who decides a Decision node: a TanStack AI decision model, through
 * `decide()`. TypeSafe and OpenRouter serve Jev, OpenAI its Decisions API,
 * Ollaya a `laya` model on this computer, Ollama any chat model pulled on
 * this computer.
 */
export const deciderNameSchema = z.enum([
	"typesafe",
	"openrouter",
	"openai",
	"ollaya",
	"ollama",
]);
export type DeciderName = z.infer<typeof deciderNameSchema>;

/** A JSON Schema object (draft 2020-12 subset), kept as data. */
export const jsonSchemaSchema = z.record(z.string(), z.unknown());

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
 * A Device by the name its owner gave it ("MacBook", "hetzner-1"). A node
 * that names one runs there (its Placement); a run refuses to start when
 * the Person who starts it has no Device of that name.
 */
export const deviceNameSchema = z.string().trim().min(1).max(64);

/** Where the node's step runs. Unset: the profile's Device, else the run's. */
export const placed = { device: deviceNameSchema.optional() };

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
 * What the check of one node reports to and reads through. The flow check
 * (`validateFlow`) makes one per node. Every issue lands on that node.
 */
export type NodeCheck = {
	error: (message: string) => void;
	warning: (message: string) => void;
	/** Checks the references of a template. `where` names its field: "prompt". */
	template: (text: string, where: string) => void;
	/**
	 * Checks that a rule (a JSONata expression) is valid and reads known
	 * names. `subject` starts each message: `The expression of "pick"`.
	 */
	rule: (expr: string, subject: string) => void;
	/** Whether an edge leaves the node on this outcome. */
	routed: (outcome: string) => boolean;
};
