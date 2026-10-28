import type { Flow, FlowInputDef } from "../document";

/** One problem in a flow. A flow with any `error` cannot run. */
export type FlowIssue = {
	severity: "error" | "warning";
	message: string;
	nodeId?: string;
	edgeId?: string;
	/** The Section the issue is about, so the editor can mark its frame. */
	sectionId?: string;
};

export type ValidateOptions = {
	/**
	 * Flow files that exist in the project, by name, for checking Call
	 * `flow` references. Leave out to skip those checks (for example in the
	 * browser before the list loads).
	 */
	flows?: Readonly<Record<string, Flow | null>>;
	/**
	 * The name of the flow being checked. With `flows`, it finds a flow that
	 * runs itself through Call nodes, and the given flow replaces the
	 * saved one of that name (an edit that is not saved yet).
	 */
	name?: string;
};

export type At = Pick<FlowIssue, "nodeId" | "edgeId" | "sectionId">;
export type Report = (message: string, at: At) => void;

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
	/** What a run of it asks for. Empty when the file does not parse. */
	inputs: FlowInputDef[];
	/** The flows whose Subflow nodes run this one, by name. */
	callers: string[];
	/** The Devices its nodes and the flows it calls run on (`FlowDevices`). */
	devices: FlowDevices;
};

/**
 * The Devices a flow names, with the flows it calls: what must be online
 * for its steps to run. A run also uses the Device it runs on, which a
 * flow does not name.
 */
export type FlowDevices = {
	/** The Devices nodes name (`device`), sorted. */
	names: string[];
	/** The Devices of the nodes' profiles, by the Device's id, sorted. */
	ids: string[];
};

export type LoadedFlow = FlowFile & {
	/** Null when the file does not parse against the schema. */
	flow: Flow | null;
	issues: FlowIssue[];
};

/** The flow files of a project, by name. Null when a file does not load. */
export type ProjectFlowMap = Readonly<Record<string, Flow | null>>;
