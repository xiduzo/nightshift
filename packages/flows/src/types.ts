import type { Flow, FlowEdge, Outcome, RunField } from "./schema";

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
