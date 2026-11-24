import {
	type Flow,
	type FlowEdge,
	type FlowNode,
	outcomeColor,
} from "../../flow";
import type {
	CallNode,
	DecisionNode,
	Option,
	VariableWrite,
} from "../../nodes";
import { parentSection } from "../../sections";
import { removeSectionAndInside, updateSection } from "../graph";
import { rewriteRefs, rewriteTemplates } from "../names";
import { claim, groupKey, type Planner, STEP_X } from "./planner";

/**
 * The caller after the move: the Call (and the Decision that routes on how
 * the new flow ended) in place of the Section.
 */
export function callerDraftOf(
	plan: Planner,
	sectionId: string,
	sectionLabel: string,
	parts: {
		callId: string;
		callerTaken: Set<string>;
		bindings: Record<string, string>;
		writeBack: VariableWrite[];
		outputOf: ReadonlyMap<string, { output: string }>;
		decided: boolean;
		exitLabels: readonly string[];
		endOptions: readonly string[];
		minX: number;
		minY: number;
	},
) {
	const { flow, options, members } = plan;
	const {
		callId,
		callerTaken,
		bindings,
		writeBack,
		outputOf,
		decided,
		exitLabels,
		endOptions,
		minX,
		minY,
	} = parts;
	// The caller: the Call (and the Decision) in place of the Section.
	const decisionId = decided
		? claim(callerTaken, `${callId}_ended`, 40, "_")
		: null;
	const call: CallNode = {
		id: callId,
		type: "call",
		...(sectionLabel.trim() !== "" && { label: sectionLabel }),
		position: { x: minX, y: minY },
		flow: options.name,
		inputs: bindings,
		...(writeBack.length > 0 && { set: writeBack }),
	};
	const decisionOptions: Option[] = [
		...plan.exits.map((exit, index) => {
			const color = colorOf(plan.byId.get(exit.from), exit.outcome);
			return {
				name: exitLabels[index] ?? exit.outcome,
				...(color !== undefined && { color }),
			};
		}),
		...endOptions.map((option) => ({ name: option })),
	].map((option, index, all) =>
		index === all.length - 1
			? option
			: {
					...option,
					when: `${callId}.ended = ${JSON.stringify(option.name)}`,
				},
	);
	const decision: DecisionNode | null =
		decisionId === null
			? null
			: {
					id: decisionId,
					type: "decision",
					position: { x: minX + STEP_X, y: minY },
					prompt: "",
					by: "rule",
					decider: "typesafe",
					options: decisionOptions,
				};

	const rewriteOuter = (text: string) =>
		rewriteRefs(text, (ref) => {
			const [field, ...rest] = ref.path;
			if (!members.has(ref.name) || field === undefined) return undefined;
			const output = outputOf.get(`${ref.name}.${field}`)?.output;
			if (output === undefined) return undefined;
			return `{{${[callId, output, ...rest].join(".")}}}`;
		});
	const firstInner = flow.nodes.findIndex((node) => members.has(node.id));
	const callerNodes: FlowNode[] = [];
	flow.nodes.forEach((node, index) => {
		if (index === firstInner) {
			callerNodes.push(call);
			if (decision) callerNodes.push(decision);
		}
		if (!members.has(node.id))
			callerNodes.push(rewriteTemplates(node, rewriteOuter));
	});

	const exitLabel = new Map(
		plan.exits.map((exit, index) => [groupKey(exit), exitLabels[index]]),
	);
	const callerEdgeIds = new Set(flow.edges.map((e) => e.id));
	const callerEdges: FlowEdge[] = [];
	let callEdgeAdded = false;
	const callEdge = (to: string): FlowEdge => ({
		id: claim(callerEdgeIds, `${callId}-pass-${to}`, 200, "-"),
		from: callId,
		outcome: "pass",
		to,
	});
	for (const edge of flow.edges) {
		const fromIn = members.has(edge.from);
		const toIn = members.has(edge.to);
		if (fromIn && toIn) continue;
		if (!fromIn) {
			callerEdges.push(toIn ? { ...edge, to: callId } : edge);
			continue;
		}
		if (decisionId !== null && !callEdgeAdded) {
			callerEdges.push(callEdge(decisionId));
			callEdgeAdded = true;
		}
		const label = exitLabel.get(`${edge.from}\u0000${edge.outcome}`);
		callerEdges.push(
			decisionId === null
				? { ...edge, from: callId, outcome: "pass" }
				: { ...edge, from: decisionId, outcome: label ?? edge.outcome },
		);
	}
	if (decisionId !== null && !callEdgeAdded)
		callerEdges.push(callEdge(decisionId));

	// The Call (and the Decision) take the Section's place in the Section
	// around it, if any.
	const around = parentSection(flow, sectionId);
	const withoutSection = removeSectionAndInside(
		{
			...flow,
			start: members.has(flow.start) ? callId : flow.start,
			nodes: callerNodes,
			edges: callerEdges,
			outputs: flow.outputs.map((output) => ({
				...output,
				value: rewriteOuter(output.value),
			})),
		},
		sectionId,
	);
	const callerDraft = around
		? updateSection(withoutSection, around.id, (holder) => ({
				...holder,
				nodes: [
					...holder.nodes,
					callId,
					...(decisionId === null ? [] : [decisionId]),
				],
			}))
		: withoutSection;
	return { decisionId, decision, callerDraft };
}

function colorOf(node: FlowNode | undefined, outcome: string) {
	return node ? outcomeColor(node, outcome) : undefined;
}

/** Whether `start` reaches itself along edges without a `max`. */
export function loopsBack(flow: Flow, start: string): boolean {
	const seen = new Set<string>();
	const queue = flow.edges
		.filter((e) => e.from === start && e.max === undefined)
		.map((e) => e.to);
	for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
		if (id === start) return true;
		if (seen.has(id)) continue;
		seen.add(id);
		for (const edge of flow.edges)
			if (edge.from === id && edge.max === undefined) queue.push(edge.to);
	}
	return false;
}
