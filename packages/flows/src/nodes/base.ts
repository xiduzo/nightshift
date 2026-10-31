import { z } from "zod";

/**
 * The parts every node type shares: names, labels, deciders, the Device a
 * step runs on, variable writes and the base fields of a node. A leaf: it
 * imports no other node file, so each node file and the flow format can
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

/**
 * A secret by name, as `${NAME}` reads it: saved on the Secrets page,
 * else set in the environment of the computer that runs the step. The rule
 * of an environment variable name, as a shell reads one.
 */
export const secretNameSchema = z
	.string()
	.regex(
		/^[A-Za-z_][A-Za-z0-9_]{0,127}$/,
		"Use letters, digits and _, starting with a letter or _.",
	);

/** A flow file name, without `.json`. */
export const flowNameSchema = z
	.string()
	.regex(
		/^[a-z0-9][a-z0-9-]{0,59}$/,
		"Use lowercase letters, digits and -, starting with a letter or digit.",
	);

/**
 * A kit by name: a flow that ships with Night Shift, read only, in a
 * group (`kit:github/publish-draft-pr`). The `kits` vertical holds them.
 */
export const kitNameSchema = z
	.string()
	.regex(
		/^kit:[a-z0-9][a-z0-9-]{0,29}\/[a-z0-9][a-z0-9-]{0,59}$/,
		"Name a kit as kit:<group>/<name>, for example kit:github/publish-draft-pr.",
	);

/** The flow a Call node runs: a flow file of the project, or a kit. */
export const calledFlowNameSchema = z.union([flowNameSchema, kitNameSchema]);

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

/**
 * Where the node's step runs. Unset: the profile's Device, else the
 * Device of the Subflow it runs in (a Call node's `device`), else the run's.
 * On a Call node: where the steps of its flow run.
 */
export const placed = { device: deviceNameSchema.optional() };

/**
 * A profile as a node names it (ADR 3): the Device it belongs to, by the
 * Device's id, and the profile's id on that Device. The profile's name is a
 * label, so a rename changes no flow. The profile's Device runs the step.
 */
export const profileRefSchema = z.object({
	/** The Device's id. */
	device: z.string().trim().min(1).max(128),
	/** The profile's id: a profile made before ids keeps its name as its id. */
	profile: z.string().trim().min(1).max(128),
});
export type ProfileRef = z.infer<typeof profileRefSchema>;

/**
 * The `profile` of a node: a `ProfileRef`, or the bare name of a profile
 * that a flow of format 6 named and that Night Shift could not find when
 * it brought the flow to format 7. A bare name does not run: the flow
 * check asks to pick the profile again.
 */
export const nodeProfileSchema = z.union([profileRefSchema, nameSchema]);
export type NodeProfile = z.infer<typeof nodeProfileSchema>;

/** Whether a node's profile names the pair, not a name left from format 6. */
export function isProfileRef(
	profile: NodeProfile | undefined,
): profile is ProfileRef {
	return typeof profile === "object" && profile !== null;
}

/** The same profile on the same Device. */
export function sameProfileRef(a: ProfileRef, b: ProfileRef): boolean {
	return a.device === b.device && a.profile === b.profile;
}

/**
 * The checks of a node's profile: a name left from format 6 must be
 * picked again, and a node that names a profile names no Device of its
 * own, because the profile's Device runs it. `title` starts each message:
 * "Agent".
 */
export function checkNodeProfile(
	node: { id: string; profile?: NodeProfile; device?: string },
	title: string,
	check: NodeCheck,
): void {
	if (node.profile === undefined) return;
	if (!isProfileRef(node.profile)) {
		check.error(
			`${title} node "${node.id}" names the profile "${node.profile}", but Night Shift cannot tell which computer's profile it is. Pick the profile again.`,
		);
		return;
	}
	if (node.device !== undefined) {
		check.error(
			`${title} node "${node.id}" names a device and a profile. The step runs on the profile's device. Remove the device, or the profile.`,
		);
	}
}

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
	/**
	 * Checks that a rule over a signal's data (`event.body.action`) is valid
	 * and reads only `event`. `subject` starts each message.
	 */
	eventRule: (expr: string, subject: string) => void;
	/** Whether an edge leaves the node on this outcome. */
	routed: (outcome: string) => boolean;
};
