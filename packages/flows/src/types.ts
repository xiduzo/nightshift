import type { Flow, FlowEdge, JsonValue, Outcome, RunField } from "./schema";

/** One problem in a flow. A flow with any `error` cannot run. */
export type FlowIssue = {
	severity: "error" | "warning";
	message: string;
	nodeId?: string;
	edgeId?: string;
};

/** Node outputs by node id, from the latest visit of each node. */
export type NodeOutputs = Record<string, Record<string, JsonValue>>;

export type TemplateContext = {
	nodes: NodeOutputs;
	/** The flow's input values, by name. */
	inputs: Record<string, JsonValue>;
	run: Record<RunField, string>;
};

/**
 * One element of a For Each list, normalized. `value` is the element as the
 * source gave it, bound to the called flow's input.
 */
export type ListItem = {
	/** Unique within the list: the element's `id`, else `name`, else its position. */
	id: string;
	/** The element's `title`, else `name`, else a short text of the value. */
	title: string;
	url: string | null;
	value: JsonValue;
	/**
	 * Elements that must be done first. A dependency that is not in the list
	 * counts by its `done` flag; plain ids from a JSON element count as done
	 * when they are not in the list.
	 */
	dependsOn: { id: string; done: boolean }[];
	/** Done before this run (for example a closed issue): skipped. */
	done: boolean;
};

export type ValidateOptions = {
	/**
	 * Flow files that exist in the project, by name, for checking For Each
	 * `flow` references. Leave out to skip those checks (for example in the
	 * browser before the list loads).
	 */
	flows?: Readonly<Record<string, Flow | null>>;
	/**
	 * The name of the flow being checked. With `flows`, it finds a flow that
	 * runs itself through For Each bodies, and the given flow replaces the
	 * saved one of that name (an edit that is not saved yet).
	 */
	name?: string;
};

/**
 * One reference found in a template: `{{name.path.to.value}}`. `name` is a
 * node id, an input, or `run`; `path` may be empty (`{{epic}}`). Path keys
 * are object keys or array indexes.
 */
export type TemplateRef = { name: string; path: string[]; raw: string };

/** A flow file in a project. */
export type FlowFile = {
	name: string;
	/** Absolute path of the JSON file. */
	path: string;
};

export type FlowListItem = FlowFile & {
	description: string | null;
	/** Null when the file does not parse against the schema. */
	nodeCount: number | null;
	errorCount: number;
};

export type LoadedFlow = FlowFile & {
	/** Null when the file does not parse against the schema. */
	flow: Flow | null;
	issues: FlowIssue[];
};

export type NextEdgeInput = {
	flow: Flow;
	from: string;
	outcome: Outcome;
	/** How often the run took each edge so far, by edge id. */
	traversals: Readonly<Record<string, number>>;
};

export type NextEdge =
	| { kind: "edge"; edge: FlowEdge }
	/** No edge leaves the node on this outcome: the flow ends here. */
	| { kind: "end" }
	/** Edges exist, but every one hit its max. */
	| { kind: "exhausted"; edges: FlowEdge[] };
