import {
	type Flow,
	type FlowNode,
	nodesWithin,
	type ServiceNode,
	sectionPath,
	serviceSection,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";

/** Where a node works: in the run's worktree, on a Device, or on no computer (`NodeKind.works` of the walk). */
export type Works = (node: FlowNode) => "worktree" | "device" | null;

/** A run's plan as the rules of the start read it: the flows, and each Device with the nodes placed on it. */
export type PlannedNodes = {
	flow: Flow;
	calledFlows: Record<string, Flow>;
	groups: readonly {
		at: { id: string; name: string };
		nodes: readonly FlowNode[];
	}[];
};

/**
 * One Device per service (ADR 9), with the Devices the plan placed each
 * step on: every step in a Service node's scope that needs a computer runs
 * on the service's Device. The validator catches what the flow alone
 * shows (a step that names another Device). This catches the rest: a
 * profile on another computer, a Subflow placed elsewhere. Throws the
 * refusal. `works` says which nodes need a computer.
 *
 * The scope of a service for the run is every node of the run's flows. A
 * Section scope is the Section's nodes, with the flows its Subflows call.
 */
export function checkServiceDevices(planned: PlannedNodes, works: Works): void {
	const placedOn = new Map<FlowNode, Map<string, string>>();
	for (const { at, nodes } of planned.groups) {
		for (const node of nodes) {
			const devices = placedOn.get(node) ?? new Map<string, string>();
			devices.set(at.id, at.name);
			placedOn.set(node, devices);
		}
	}
	const flows = [planned.flow, ...Object.values(planned.calledFlows)];
	const allNodes = flows.flatMap((flow) => flow.nodes);
	for (const flow of flows) {
		for (const service of flow.nodes) {
			if (service.type !== "service") continue;
			const own = placedOn.get(service);
			if (!own || own.size === 0) continue;
			const scope =
				serviceSection(service) === null
					? allNodes
					: sectionNodes(flow, service, planned.calledFlows);
			for (const node of scope) {
				if (node === service || works(node) === null) continue;
				for (const [id, name] of placedOn.get(node) ?? []) {
					if (own.has(id)) continue;
					const [serviceAt] = [...own.values()];
					throw new Refusal(
						"conflict",
						`The flow runs node "${node.id}" on ${name}, but the service "${service.id}" runs on ${serviceAt}. Every step while the service runs must run on its device. Place them on the same device.`,
					);
				}
			}
		}
	}
}

/** The nodes of the service's Section, and of the flows its Subflows call, at any depth. */
function sectionNodes(
	flow: Flow,
	service: ServiceNode,
	called: Record<string, Flow>,
): FlowNode[] {
	const id = serviceSection(service);
	const section = id === null ? undefined : sectionPath(flow, id).at(-1);
	if (!section) return [];
	const inside = new Set(nodesWithin(flow, section));
	const nodes = flow.nodes.filter((node) => inside.has(node.id));
	const seen = new Set<string>();
	const out: FlowNode[] = [];
	const walk = (list: readonly FlowNode[]) => {
		for (const node of list) {
			out.push(node);
			if (node.type !== "call" || seen.has(node.flow)) continue;
			seen.add(node.flow);
			const body = called[node.flow];
			if (body) walk(body.nodes);
		}
	};
	walk(nodes);
	return out;
}
