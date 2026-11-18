import {
	FLOW_VERSION,
	type Flow,
	type FlowEdge,
	type FlowInputDef,
	type FlowNode,
	type FlowOutputDef,
	type FlowVariableDef,
} from "../../flow";
import type { DecisionNode } from "../../nodes";
import { sectionsWithin } from "../../sections";
import type { TemplateRef } from "../../template";
import { rewriteRefs, rewriteTemplates } from "../names";
import { claim, type Planner } from "./planner";

/** The new flow, before the schema reads it: the nodes inside, their edges and the end nodes. */
export function subflowDraftOf(
	plan: Planner,
	sectionId: string,
	sectionDescription: string | undefined,
	parts: {
		inputs: FlowInputDef[];
		outputs: FlowOutputDef[];
		subVariables: FlowVariableDef[];
		inputOf: ReadonlyMap<string, string>;
		endNodes: ReadonlyMap<string, DecisionNode>;
		shift: (position: { x: number; y: number }) => { x: number; y: number };
	},
): Flow {
	const { flow, entry, members } = plan;
	const { inputs, outputs, subVariables, inputOf, endNodes, shift } = parts;
	// The new flow's edges: the ones inside, and one per exit to its end node.
	const subEdges: FlowEdge[] = [];
	const subEdgeIds = new Set(
		flow.edges
			.filter((e) => members.has(e.from) && members.has(e.to))
			.map((e) => e.id),
	);
	const routedEnd = new Set<string>();
	for (const edge of flow.edges) {
		if (!members.has(edge.from)) continue;
		if (members.has(edge.to)) {
			subEdges.push(edge);
			continue;
		}
		const key = `${edge.from}\u0000${edge.outcome}`;
		const end = endNodes.get(key);
		if (!end || routedEnd.has(key)) continue;
		routedEnd.add(key);
		subEdges.push({
			id: claim(subEdgeIds, `${edge.from}-${edge.outcome}-${end.id}`, 200, "-"),
			from: edge.from,
			outcome: edge.outcome,
			to: end.id,
		});
	}

	// The Sections inside the Section go along, the outer ones now on top.
	const own = flow.sections?.find((section) => section.id === sectionId);
	const inside = own ? sectionsWithin(flow, own) : [];
	const subflowDraft: Flow = {
		version: FLOW_VERSION,
		...(sectionDescription !== undefined &&
			sectionDescription.trim() !== "" && {
				description: sectionDescription,
			}),
		inputs,
		outputs,
		...(subVariables.length > 0 && { variables: subVariables }),
		start: entry,
		nodes: [
			...plan.inner.map((node) =>
				rewriteTemplates({ ...node, position: shift(node.position) }, (text) =>
					rewriteInner(text, members, plan.byId, inputOf),
				),
			),
			...endNodes.values(),
		],
		edges: subEdges,
		...(inside.length > 0 && { sections: inside }),
	};
	return subflowDraft;
}

/**
 * A template inside: a node outside or a run field that differs in a Call
 * reads its input. The caller's inputs keep their names.
 */
function rewriteInner(
	text: string,
	members: ReadonlySet<string>,
	byId: ReadonlyMap<string, FlowNode>,
	inputOf: ReadonlyMap<string, string>,
): string {
	return rewriteRefs(text, (ref: TemplateRef) => {
		const [field, ...rest] = ref.path;
		if (field === undefined) return undefined;
		let input: string | undefined;
		if (ref.name === "run") input = inputOf.get(`run:${field}`);
		else if (byId.has(ref.name) && !members.has(ref.name))
			input = inputOf.get(`node:${ref.name}.${field}`);
		if (input === undefined) return undefined;
		return `{{${[input, ...rest].join(".")}}}`;
	});
}
