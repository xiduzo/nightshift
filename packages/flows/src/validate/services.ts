import type { Flow, FlowNode } from "../flow";
import { isProfileRef, type ServiceNode, serviceSection } from "../nodes";
import { profileOf } from "../profiles";
import { nodesWithin, sectionPath } from "../sections";
import type { Report } from "./issues";

/**
 * One Device per service (ADR 9): every step in a Service node's scope
 * runs on the service's Device, so it reaches the service. A flow tells
 * only part of where a step runs: a Device by name, a profile's Device by
 * id, or the run's Device. This check errors where the flow alone shows
 * two different Devices. Run start checks the rest, with the Devices it
 * placed the steps on.
 */
export function checkServicePlacement(flow: Flow, error: Report): void {
	for (const service of flow.nodes) {
		if (service.type !== "service") continue;
		const own = placeOf(service);
		for (const node of scopeOf(flow, service)) {
			if (node.id === service.id || !runsOnDevice(node)) continue;
			const there = placeOf(node);
			if (!differs(own, there)) continue;
			error(
				`Node "${node.id}" runs on ${words(there)}, but the service "${service.id}" runs on ${words(own)}. Every step while the service runs must run on its device. Give them the same device.`,
				{ nodeId: node.id },
			);
		}
	}
}

/** Where a node runs, as far as the flow says. */
type Place =
	| { kind: "name"; name: string }
	| { kind: "profile"; device: string }
	| { kind: "run" };

function placeOf(node: FlowNode): Place {
	const profile = profileOf(node);
	if (isProfileRef(profile)) return { kind: "profile", device: profile.device };
	if ("device" in node && node.device !== undefined) {
		return { kind: "name", name: node.device };
	}
	return { kind: "run" };
}

/** Two places that the flow alone shows to be different Devices. A name and a profile it cannot tell. */
function differs(a: Place, b: Place): boolean {
	if (a.kind === "profile" && b.kind === "profile")
		return a.device !== b.device;
	if (a.kind === "profile" || b.kind === "profile") return false;
	if (a.kind === "name" && b.kind === "name") return a.name !== b.name;
	return a.kind !== b.kind;
}

function words(place: Place): string {
	switch (place.kind) {
		case "name":
			return `the device "${place.name}"`;
		case "profile":
			return "the device of its profile";
		case "run":
			return "the run's device";
	}
}

/** The nodes the service runs for: its Section's, else the flow's. */
function scopeOf(flow: Flow, service: ServiceNode): FlowNode[] {
	const id = serviceSection(service);
	if (id === null) return flow.nodes;
	const section = sectionPath(flow, id).at(-1);
	if (!section) return [];
	const inside = new Set(nodesWithin(flow, section));
	return flow.nodes.filter((node) => inside.has(node.id));
}

/** Whether a step of the node runs on a computer: a process, a session, a tool, a model or a flow there. */
function runsOnDevice(node: FlowNode): boolean {
	switch (node.type) {
		case "agent":
		case "command":
		case "tool":
		case "service":
		case "call":
			return true;
		case "decision":
		case "value":
			return node.by === "model";
		case "wait":
			return node.until.kind === "command" || node.until.kind === "any";
		case "end":
		case "join":
		case "lease":
			return false;
	}
}
