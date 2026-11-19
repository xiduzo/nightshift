import {
	deviceIdOf,
	type FlowNode,
	isProfileRef,
	type ProfileRef,
	profileOf,
} from "@nightshift/flows";

/**
 * Where a run's steps run, decided once when it starts
 * (`PlacementPort.plan`) and kept on its row: the walk reads it
 * (`planOf`) and decides nothing.
 */
export type RunPlan = {
	/** The run's Device: its worktree, and the steps of every node that names no Device. */
	device: PlannedDevice;
	/** The Devices the nodes name by their name (`device`), by that name. */
	named: Record<string, PlannedDevice>;
	/**
	 * Every Device of the plan by its id: the run's, the named ones, and
	 * the Devices of the profiles the nodes name (`ProfileRef.device`).
	 * A node with a profile runs on its profile's Device, by that id.
	 */
	devices: Record<string, PlannedDevice>;
	/**
	 * The Person the run runs for, as the Host of its Space knows them:
	 * every Device of the plan serves its steps for them. Null only for a
	 * run another Replica walked before every run had one.
	 */
	personId: string | null;
	/** Where a step goes when its Device cannot take it (ADR 17). Absent: it waits. */
	fallbacks?: RunFallbacks;
};

/** What a profile fills in on a node: a step on a fallback Device runs with its own. */
export type NodeFields = {
	harness?: string;
	model?: string;
	permissionMode?: string;
	effort?: string;
	clis?: string[];
	connections?: string[];
	decider?: string;
	address?: unknown;
};

/** A Device a step can move to. A node with a profile has that Device's profile of the same name. */
export type FallbackDevice = PlannedDevice & {
	profile?: ProfileRef;
	fields?: NodeFields;
};

/**
 * Where a step goes when its Device cannot take it, in order: `nodes` for a
 * node that names a Device, by `fallbackKey`, else `run`.
 */
export type RunFallbacks = {
	run: FallbackDevice[];
	nodes: Record<string, FallbackDevice[]>;
	/** The Host among these Devices, for the words of a move (`takenOverSecrets`). */
	hostId?: string;
};

/** The key of a node in `RunFallbacks.nodes`: its id and the Device it names. */
export function fallbackKey(node: FlowNode): string {
	const ref = profileOf(node);
	const device = isProfileRef(ref)
		? `${ref.device}\u0000${ref.profile}`
		: "device" in node
			? String(deviceIdOf(node.device))
			: "";
	return `${node.id}\u0000${device}`;
}

/** A Device of a run's plan. Its name is null for a run from before the plan kept names. */
export type PlannedDevice = { id: string; name: string | null };
