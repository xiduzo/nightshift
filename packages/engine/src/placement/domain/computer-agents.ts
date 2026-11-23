import { type Flow, type FlowNode, namesNoAgent } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { namedDevice } from "./node-places";
import type { PlacedOn, PlanLookups } from "./plan-shapes";

/**
 * The flows with each Agent node that names no agent (`namesNoAgent`) on
 * the first Agent Profile of the Device it runs on: the one it names, else
 * the one the nearest Subflow around it names, else the run's. A kit's
 * Agent node names none: a kit cannot name a profile of anyone's computer.
 * Refuses when that Device has no Agent Profile, or when Night Shift
 * cannot tell its profiles. `flows` is the run's flow, then `calledNames`'s.
 */
export async function withComputerAgents<D>(
	flows: readonly Flow[],
	calledNames: readonly string[],
	run: PlacedOn<D>,
	devices: Pick<PlanLookups<D>, "profilesOf" | "deviceName">,
): Promise<Flow[]> {
	const nameless = (flow: Flow) =>
		flow.nodes.some((node) => node.type === "agent" && namesNoAgent(node));
	if (!flows.some(nameless)) return [...flows];
	// The Device a Subflow names, by the flow it calls: the nearest wins.
	const around = new Map<string, string>();
	flows.forEach((flow, index) => {
		const name = index === 0 ? null : (calledNames[index - 1] ?? null);
		const inherited = name === null ? undefined : around.get(name);
		for (const node of flow.nodes) {
			if (node.type !== "call") continue;
			const id = namedDevice(node) ?? inherited;
			if (id !== undefined && !around.has(node.flow)) around.set(node.flow, id);
		}
	});
	const agents = new Map<string, string | null>();
	const agentOn = async (deviceId: string) => {
		if (!agents.has(deviceId)) {
			const listed = (await devices.profilesOf?.(deviceId)) ?? null;
			agents.set(
				deviceId,
				listed?.find((profile) => profile.kind === "agent")?.id ?? null,
			);
		}
		return agents.get(deviceId) ?? null;
	};
	const missing: string[] = [];
	const placed: Flow[] = [];
	for (const [index, flow] of flows.entries()) {
		const name = index === 0 ? null : (calledNames[index - 1] ?? null);
		if (!nameless(flow)) {
			placed.push(flow);
			continue;
		}
		const nodes: FlowNode[] = [];
		for (const node of flow.nodes) {
			if (node.type !== "agent" || !namesNoAgent(node)) {
				nodes.push(node);
				continue;
			}
			const deviceId =
				namedDevice(node) ??
				(name === null ? undefined : around.get(name)) ??
				run.id;
			const profile = await agentOn(deviceId);
			if (profile === null) {
				const device =
					deviceId === run.id
						? run.name
						: ((await devices.deviceName?.(deviceId)) ?? "its device");
				const words = `Node "${node.id}" names no agent, and Night Shift found no agent profile on ${device}. Add one on the Agents page of ${device}.`;
				if (!missing.includes(words)) missing.push(words);
				nodes.push(node);
				continue;
			}
			// The profile names its Device: the node names none of its own.
			const { device: _device, ...rest } = node;
			nodes.push({ ...rest, profile: { device: deviceId, profile } });
		}
		placed.push({ ...flow, nodes });
	}
	if (missing.length > 0) throw new Refusal("invalid", missing.join(" "));
	return placed;
}
