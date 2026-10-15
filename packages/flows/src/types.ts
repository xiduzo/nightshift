import type { Flow, FlowEdge, ItemField, Outcome, RunField } from "./schema";

/** One problem in a flow. A flow with any `error` cannot run. */
export type FlowIssue = {
	severity: "error" | "warning";
	message: string;
	nodeId?: string;
	edgeId?: string;
};

/** Node outputs by node id, from the latest visit of each node. */
export type NodeOutputs = Record<string, Record<string, string | number>>;

export type TemplateContext = {
	nodes: NodeOutputs;
	run: Record<RunField, string>;
	/** Set inside a For Each body. */
	item?: Partial<Record<ItemField, string | number>>;
};

/** One item of a For Each source, before the engine adds branches. */
export type SourceItem = {
	/** Unique within the source. The issue number for GitHub. */
	id: string;
	number?: number;
	title: string;
	body?: string;
	url?: string;
	/** Ids of items (or other issues) that must be done first. */
	blockedBy: { id: string; done: boolean }[];
	/** Done before this run: closed, or carries a done label. Skipped. */
	done: boolean;
	parentNumber?: number;
	parentTitle?: string;
};

export type ValidateOptions = {
	/**
	 * Flow files that exist in the project, by name, for checking For Each
	 * `flow` references. Leave out to skip those checks (for example in the
	 * browser before the list loads).
	 */
	flows?: Readonly<Record<string, Flow | null>>;
};

/** One `{{a.b}}` reference found in a template. */
export type TemplateRef = { scope: string; field: string; raw: string };

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
