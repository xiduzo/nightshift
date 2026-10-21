import type { JsonValue } from "../nodes";

/** What a template or a rule reads: the run, the inputs, the variables and the node outputs. */

/**
 * Fields of the run: `{{run.branch}}`. Inside a Call with `each`, `branch`
 * is the element's branch, `base_branch` the branch it builds on, and
 * `index` the element's position (from 0). Outside, both are "".
 */
export const runFields = [
	"branch",
	"base_branch",
	"index",
	"worktree",
	"base_ref",
	"flow",
] as const;
export type RunField = (typeof runFields)[number];

/** Node outputs by node id, from the latest visit of each node. */
export type NodeOutputs = Record<string, Record<string, JsonValue>>;

export type TemplateContext = {
	nodes: NodeOutputs;
	/** The flow's input values, by name. */
	inputs: Record<string, JsonValue>;
	run: Record<RunField, string>;
	/** The flow's variables, by name: `{{vars.tries}}`. Absent: the flow has none. */
	vars?: Record<string, JsonValue>;
};

/**
 * One reference found in a template: `{{name.path.to.value}}`. `name` is a
 * node id, an input, `run`, or `vars`; `path` may be empty (`{{epic}}`). Path keys
 * are object keys or array indexes.
 */
export type TemplateRef = { name: string; path: string[]; raw: string };
