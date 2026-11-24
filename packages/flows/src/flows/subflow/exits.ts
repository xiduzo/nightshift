import {
	endedLabel,
	type FlowNode,
	nodeOutcomes,
	outcomeColor,
} from "../../flow";
import { type DecisionNode, reservedOutcomes } from "../../nodes";
import {
	claim,
	endsFlowOn,
	groupKey,
	type Planner,
	STEP_X,
	STEP_Y,
	uniqueList,
} from "./planner";

/** Where the new flow ends: the ends inside the Section, and a label per exit. */
export function subflowExits(plan: Planner) {
	const { flow } = plan;
	// Ends inside: outcomes without an edge that end the flow as chosen.
	const ends: { node: FlowNode; outcome: string; label: string }[] = [];
	for (const node of plan.inner) {
		for (const outcome of nodeOutcomes(node)) {
			const routed = flow.edges.some(
				(e) => e.from === node.id && e.outcome === outcome,
			);
			if (!routed && endsFlowOn(node, outcome))
				ends.push({ node, outcome, label: endedLabel(node, outcome) });
		}
	}
	const endOptions = uniqueList(
		ends.map((end) => (end.label === "" ? "pass" : end.label)),
	);
	const decided =
		plan.exits.length + endOptions.length >= 2 ||
		(plan.exits.length === 0 &&
			endOptions.length === 1 &&
			endOptions[0] !== "pass");

	// A label per exit: its outcome when that tells it apart, else node and outcome.
	const labelTaken = new Set<string>([...endOptions, ...reservedOutcomes]);
	const outcomeCount = new Map<string, number>();
	for (const exit of plan.exits)
		outcomeCount.set(exit.outcome, (outcomeCount.get(exit.outcome) ?? 0) + 1);
	const exitLabels = plan.exits.map((exit) => {
		const own = `${exit.from.replace(/_/g, "-")}-${exit.outcome}`;
		const base =
			outcomeCount.get(exit.outcome) === 1 && !labelTaken.has(exit.outcome)
				? exit.outcome
				: own;
		return claim(labelTaken, base, 30, "-");
	});
	return { ends, endOptions, decided, exitLabels };
}

/**
 * Where the nodes of the new flow sit, and its end nodes: one per exit
 * that the Call must tell apart.
 */
export function subflowEndNodes(
	plan: Planner,
	exits: { decided: boolean; exitLabels: readonly string[] },
	subTaken: Set<string>,
) {
	const { flow, members } = plan;
	const { decided, exitLabels } = exits;
	// Positions: the Call where the Section's top left corner was.
	const minX = Math.min(...plan.inner.map((node) => node.position.x));
	const minY = Math.min(...plan.inner.map((node) => node.position.y));
	const shift = (position: { x: number; y: number }) => ({
		x: position.x - minX,
		y: position.y - minY,
	});

	// End nodes of the new flow, where the Call must tell the exit apart.
	// They go in a column right of every inner node, each level with its
	// node unless the end above is in the way, so none covers a node.
	const endNodes = new Map<string, DecisionNode>();
	const endX =
		Math.max(...plan.inner.map((node) => node.position.x)) - minX + STEP_X;
	let endY = Number.NEGATIVE_INFINITY;
	plan.exits.forEach((exit, index) => {
		const from = plan.byId.get(exit.from);
		const label = exitLabels[index];
		if (!from || label === undefined) return;
		const leadsInside = flow.edges.some(
			(e) =>
				e.from === exit.from && e.outcome === exit.outcome && members.has(e.to),
		);
		if (!decided && endsFlowOn(from, exit.outcome) && !leadsInside) return;
		const y = Math.max(from.position.y - minY, endY + STEP_Y);
		endY = y;
		const color = outcomeColor(from, exit.outcome);
		endNodes.set(groupKey(exit), {
			id: claim(subTaken, `end_${label.replace(/-/g, "_")}`, 40, "_"),
			type: "decision",
			position: { x: endX, y },
			prompt: "",
			by: "rule",
			decider: "typesafe",
			options: [{ name: label, ...(color !== undefined && { color }) }],
		});
	});
	return { minX, minY, shift, endNodes };
}
