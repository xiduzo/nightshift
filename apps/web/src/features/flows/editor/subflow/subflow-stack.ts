import { isKitName } from "@nightshift/flows";

/**
 * The Subflows you look inside, from the flow open in the editor down to
 * the one the canvas shows. Each level is one Call node and the flow it
 * runs. The editor's own flow is the root: it is not a level.
 */

/** Where a canvas looked when you left it to look deeper. */
export type SubflowViewport = { x: number; y: number; zoom: number };

export type SubflowLevel = {
	/** The Call node, in the flow one level up. */
	nodeId: string;
	/** The flow the Call node runs. */
	flow: string;
	/** Set when you looked deeper from this level: going back up restores it. */
	viewport?: SubflowViewport;
};

export type SubflowStack = readonly SubflowLevel[];

/** One step deeper: `viewport` is where the current level looked. */
export function enterSubflow(
	stack: SubflowStack,
	level: { nodeId: string; flow: string },
	viewport?: SubflowViewport,
): SubflowStack {
	const current = stack.at(-1);
	const kept =
		current && viewport
			? [...stack.slice(0, -1), { ...current, viewport }]
			: stack;
	return [...kept, { nodeId: level.nodeId, flow: level.flow }];
}

/** Back up to `depth` levels below the root: 0 is the editor's own flow. */
export function leaveSubflowTo(
	stack: SubflowStack,
	depth: number,
): SubflowStack {
	if (depth >= stack.length) return stack;
	return stack.slice(0, Math.max(0, depth));
}

/** One level up, or the same stack at the root. */
export function leaveSubflow(stack: SubflowStack): SubflowStack {
	return leaveSubflowTo(stack, stack.length - 1);
}

/**
 * Whether the deepest level runs a flow that is already open above it:
 * the root flow or a level between. That flow contains itself, and looking
 * inside would never end.
 */
export function isSubflowCycle(rootFlow: string, stack: SubflowStack): boolean {
	const current = stack.at(-1);
	if (!current) return false;
	return (
		current.flow === rootFlow ||
		stack.slice(0, -1).some((level) => level.flow === current.flow)
	);
}

export type SubflowCrumb = {
	/** 0 for the root flow, else the level's place in the stack plus 1. */
	depth: number;
	flow: string;
	/** The Call node that runs `flow`, or null for the root. */
	nodeId: string | null;
};

/** One crumb per level, the root first. */
export function subflowCrumbs(
	rootFlow: string,
	stack: SubflowStack,
): SubflowCrumb[] {
	return [
		{ depth: 0, flow: rootFlow, nodeId: null },
		...stack.map((level, index) => ({
			depth: index + 1,
			flow: level.flow,
			nodeId: level.nodeId,
		})),
	];
}

/** What the canvas shows for the deepest level. */
export type SubflowContent<F> =
	| { kind: "cycle" }
	| { kind: "loading" }
	| { kind: "missing" }
	| { kind: "invalid" }
	| { kind: "flow"; flow: F };

/**
 * The deepest level's flow, from the project's flow files by name (null for
 * a file that is not valid, undefined while they load), or a kit by
 * `kitOf`, which needs no load. A cycle wins: that flow is open above
 * already.
 */
export function subflowContent<F>(
	rootFlow: string,
	stack: SubflowStack,
	flows: Readonly<Record<string, F | null>> | undefined,
	kitOf: (name: string) => F | undefined = () => undefined,
): SubflowContent<F> | null {
	const current = stack.at(-1);
	if (!current) return null;
	if (isSubflowCycle(rootFlow, stack)) return { kind: "cycle" };
	if (isKitName(current.flow)) {
		const kit = kitOf(current.flow);
		return kit ? { kind: "flow", flow: kit } : { kind: "missing" };
	}
	if (flows === undefined) return { kind: "loading" };
	if (!Object.hasOwn(flows, current.flow)) return { kind: "missing" };
	const flow = flows[current.flow];
	return flow ? { kind: "flow", flow } : { kind: "invalid" };
}

/** A key press, as the keys that go into a Subflow and back up read it. */
export type SubflowKeyPress = {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	defaultPrevented: boolean;
	/** True while you type in a field, or a menu, a list or a dialog has the focus. */
	inField: boolean;
};

/** `i` looks inside the selected Subflow, `u` or Escape goes one level up. */
export function subflowKey(press: SubflowKeyPress): "in" | "up" | null {
	if (
		press.defaultPrevented ||
		press.inField ||
		press.metaKey ||
		press.ctrlKey ||
		press.altKey
	)
		return null;
	if (press.key === "i" || press.key === "I") return "in";
	if (press.key === "u" || press.key === "U" || press.key === "Escape")
		return "up";
	return null;
}
