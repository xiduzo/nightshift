import { z } from "zod";

/**
 * The names of a flow: a node id, an input, a variable, a flow file, a kit,
 * an outcome and a secret, and the names Night Shift keeps for itself. A
 * leaf: it imports no other node file.
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
 * The names a rule reads as its own, besides the flow's: a Since last run
 * rule reads the value of the last run as `previous` and this one as
 * `current`. They win over a node or an input of that name, so that rule
 * cannot read it. The editor refuses them for a node or an input, and the
 * check warns about a flow that has one. A variable may take them: a rule
 * reads it as `vars.<name>`. The other rules read only their own value
 * (`event`, `data`) or the flow's, so they keep no other name.
 */
export const ruleOwnNames = ["previous", "current"] as const;

/**
 * The names a template reads as its own, besides the flow's: a node with
 * a cascade reads its try as `cascade` (`{{cascade.tier}}`, ADR 6). A node
 * or an input of that name wins over it, so that node's templates cannot
 * read its cascade. The editor refuses it for a node or an input, and the
 * check warns about a flow that has one. A variable may take it: a
 * template reads it as `vars.cascade`.
 */
export const templateOwnNames = ["cascade"] as const;
