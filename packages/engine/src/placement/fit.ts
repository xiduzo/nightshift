import {
	FLOW_VERSION,
	type FlowNode,
	type FlowNodeType,
} from "@nightshift/flows";
import type { Capabilities, Device } from "../device";
import {
	kindOf,
	kindOfType,
	missingNames,
	NODE_KINDS,
	type NodeKind,
	onDevice,
	type Requirement,
} from "../graph";

/**
 * The fit check: whether a Device can take these nodes, written once for
 * every time Placement asks it (ADR 17, decision 3; ADR 19, decision 4).
 * The plan asks it at run start for each Device of its order
 * (`device-order.ts`), run start asks it of each Device for the nodes
 * placed there before the run is written (`prepareRun`), and a step asks
 * it of each fallback when its Device goes offline (`placement.ts`).
 *
 * The requirements are one function each (`Requirement`) and listed once,
 * in `REQUIREMENTS`, in the order the person sees them. The ones about one
 * kind live on that kind's descriptor (`NodeKind.requirements`: an Agent's
 * CLI tools and harness, a model Decision's and a model Value's
 * decider); the connections check is the one shared requirement, and it
 * asks each kind which connections its node names (`NodeKind.connections`).
 * This module switches on no node type to ask them.
 */

/**
 * The flow format a Device reads when it does not say: the last one before
 * Devices advertised theirs (`Capabilities.flowVersion`).
 */
export const UNADVERTISED_FLOW_VERSION = 8;

/**
 * The Device reads this build's flow format: one of an older Night Shift
 * may not know a field or a node of the flow, so no step goes there and no
 * run moves there. A Device that does not say reads format 8. One rule for
 * every flow, not only for one that uses what format 9 added: it is the
 * simpler safe rule, and an update fixes it.
 */
export const readsTheFlow: Requirement = (_nodes, has) => {
	if ((has.flowVersion ?? UNADVERTISED_FLOW_VERSION) >= FLOW_VERSION) {
		return null;
	}
	return olderNightShift(has.elsewhere ?? "this computer");
};

/** Why a Device of an older Night Shift cannot take the run, or its walk. */
export function olderNightShift(name: string): string {
	return `${name} runs an older version of Night Shift. Update Night Shift on ${name}.`;
}

/** Every node names connections the Device has (Agent and Tool nodes do). */
export const connectionsExist: Requirement = (nodes, has) => {
	const unknown = missingNames(
		nodes,
		(node) => kindOf(node).connections(node),
		new Set(has.connections),
	);
	if (unknown.length === 0) return null;
	return unknown
		.map(
			({ name, nodeIds }) =>
				`The flow uses the connection "${name}" (${nodeIds.join(", ")}), but no connection has that name${onDevice(has)}. Add it under Agents → Tools.`,
		)
		.join(" ");
};

/**
 * A kind's own requirements as ones over every node: each gets the nodes
 * of its kind only, so it switches on nothing.
 */
function ofKind(kind: NodeKind): Requirement[] {
	return kind.requirements.map(
		(requirement) => (nodes, has) =>
			requirement(
				nodes.filter((n) => n.type === kind.type),
				has,
			),
	);
}

/**
 * Every requirement, in the order a person sees them: the flow format
 * first, then the connections every kind names, then each kind's own,
 * kind by kind in the registry's order (`NODE_KINDS`).
 */
export const REQUIREMENTS: readonly Requirement[] = [
	readsTheFlow,
	connectionsExist,
	...(Object.keys(NODE_KINDS) as FlowNodeType[]).flatMap((type) =>
		ofKind(kindOfType(type)),
	),
];

/** What the Device has for these nodes: its capabilities, with the programs the nodes name looked up. */
export function capabilitiesFor(
	nodes: readonly FlowNode[],
	device: Pick<Device, "capabilities">,
): Promise<Capabilities> {
	const programs = new Set(nodes.flatMap((n) => kindOf(n).programs(n)));
	return device.capabilities({ programs: [...programs] });
}

/** The first requirement these nodes fail, as the message that refuses the run; null when all pass. */
export function refusalOf(
	nodes: readonly FlowNode[],
	has: Capabilities,
): string | null {
	for (const requirement of REQUIREMENTS) {
		const why = requirement(nodes, has);
		if (why !== null) return why;
	}
	return null;
}

/** A Device as the fit check sees it: its name for the reason, and what the plan knows of it. */
export type FitDevice = {
	name: string;
	/** It takes no work now. */
	offline?: boolean;
	/** It has a Clone of the project. */
	hasClone: boolean;
	/** Another Person's Device: its Offers stand in for the requirements, which it checks itself. */
	offered?: object;
};

/**
 * Why a Device cannot take these nodes now, or null when it can: it is
 * online, it has the project when a node works in the worktree, and it has
 * what the nodes need (`REQUIREMENTS`). `has` is asked only when the
 * cheaper checks pass: what the Device has, or null when it cannot be
 * reached.
 */
export async function unfit(
	at: FitDevice,
	nodes: readonly FlowNode[],
	has: () => Promise<Capabilities | null>,
): Promise<string | null> {
	if (at.offline) return `${at.name} is offline`;
	if (
		!at.hasClone &&
		nodes.some((node) => kindOf(node).works(node) === "worktree")
	) {
		return `${at.name} does not have this project`;
	}
	if (at.offered) return null;
	const known = await has();
	if (known === null) return `${at.name} cannot be reached`;
	const why = refusalOf(nodes, known);
	return why === null ? null : `${at.name}: ${why}`;
}
