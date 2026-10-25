import {
	type AgentProfileSettings,
	type Flow,
	type FlowNode,
	resolveAgentNode,
} from "@nightshift/flows";
import type {
	PlacedDevice,
	PlannedDevice,
	PlannedRun,
	StartRunInput,
} from "../contract";
import { flowsForRun } from "../flows";

/**
 * The node walk of a run's plan: where each node runs, and its profile.
 * The Placement rule is written once here: a node's `device`, else its
 * profile's Device (the run's Device when it has the profile, else this
 * computer when only it has it), else the run's Device. Who the Devices
 * are (the Person's own or offered, online, by name) is the caller's: the
 * devices' planner (`PlacementPort.plan`) passes its lookups, and so does
 * the engine's own fake of a computer alone.
 */

/** What the node walk asks of the Devices a run may use. */
export type PlanDevices = {
	/** This computer: the Walker, and where a profile only it has runs. */
	walker: PlacedDevice;
	/**
	 * The run's Device by its id: this computer (`walker`), or another
	 * Device the Person may use, checked. Null when this computer cannot
	 * reach it. Throws a refusal of its own (not theirs, offline).
	 */
	byId(id: string): Promise<PlacedDevice | null>;
	/**
	 * A Device by the name a node gives it: this computer, one of the
	 * Person's other Devices, or another Person's through its Offers. Null
	 * when there is none of that name. Throws a refusal of its own (two of
	 * that name, offline).
	 */
	byName(name: string): Promise<PlacedDevice | null>;
	/** An Agent Profile of this computer by name, or null. */
	profileFor(name: string): AgentProfileSettings | null;
};

/** The refusal of a Device this computer cannot reach: the devices' planner refuses with it too. */
export const UNREACHABLE_DEVICE =
	"That device cannot take runs from this computer. Pair it with this computer, or choose another device.";

/** The Device a node names, if its kind runs on one. */
function namedDevice(node: FlowNode): string | undefined {
	return "device" in node ? node.device : undefined;
}

const planned = (at: PlacedDevice): PlannedDevice => ({
	id: at.id,
	name: at.name,
});

/**
 * Where each node runs, and its profile. Returns the flows with their
 * profiles resolved, a node that runs on this computer for its profile
 * named so, and the Devices by name.
 */
async function placeNodes(
	flows: readonly Flow[],
	runDevice: PlacedDevice,
	devices: PlanDevices,
): Promise<{ flows: Flow[]; named: Map<string, PlacedDevice> }> {
	const nodes = flows.flatMap((f) => f.nodes);
	const named = new Map<string, PlacedDevice>();
	for (const node of nodes) {
		const name = namedDevice(node);
		if (name === undefined || named.has(name)) continue;
		if (name === runDevice.name) {
			named.set(name, runDevice);
			continue;
		}
		const found = await devices.byName(name);
		if (!found) {
			throw new Error(
				`The flow names the device "${name}", but you have no device of that name, and none of that name offers profiles to this Space. Check the node's device.`,
			);
		}
		named.set(name, found);
	}

	// The profiles each Device is asked for: a node's own Device, else the
	// run's, with this computer as the fallback.
	const walker = devices.walker.id !== runDevice.id ? devices.walker : null;
	const wanted = new Map<PlacedDevice, Set<string>>();
	const want = (at: PlacedDevice, profile: string) => {
		const set = wanted.get(at) ?? new Set();
		set.add(profile);
		wanted.set(at, set);
	};
	// Another Person's Device resolves its offered profiles itself.
	const fallback =
		walker && !walker.offered && !runDevice.offered ? walker : null;
	for (const node of nodes) {
		if (node.type !== "agent" || node.profile === undefined) continue;
		const name = namedDevice(node);
		const at =
			name !== undefined ? (named.get(name) as PlacedDevice) : runDevice;
		if (!at.offered) want(at, node.profile);
		if (name === undefined && fallback) want(fallback, node.profile);
	}
	const found = new Map<PlacedDevice, Record<string, AgentProfileSettings>>();
	for (const [at, names] of wanted) {
		found.set(
			at,
			at.thisDevice
				? Object.fromEntries(
						[...names].flatMap((n) => {
							const profile = devices.profileFor(n);
							return profile ? [[n, profile]] : [];
						}),
					)
				: (await at.device.capabilities({ profiles: [...names] })).profiles,
		);
	}

	const missing = new Map<string, { nodeIds: string[]; on: string | null }>();
	const miss = (profile: string, nodeId: string, on: string | null) => {
		const key = `${profile}\u0000${on ?? ""}`;
		const entry = missing.get(key) ?? { nodeIds: [], on };
		if (!entry.nodeIds.includes(nodeId)) entry.nodeIds.push(nodeId);
		missing.set(key, entry);
	};
	const placed = flows.map((flow) => ({
		...flow,
		nodes: flow.nodes.map((node): FlowNode => {
			if (node.type !== "agent" || node.profile === undefined) return node;
			const name = namedDevice(node);
			const placedAt =
				name !== undefined ? (named.get(name) as PlacedDevice) : runDevice;
			// Offered: the run's copy never holds the profile's settings.
			if (placedAt.offered) return node;
			if (name !== undefined) {
				const at = named.get(name) as PlacedDevice;
				const profile = found.get(at)?.[node.profile];
				if (!profile) {
					miss(node.profile, node.id, at.thisDevice ? null : at.name);
					return node;
				}
				return resolveAgentNode(node, profile);
			}
			const own = found.get(runDevice)?.[node.profile];
			if (own) return resolveAgentNode(node, own);
			const here = fallback ? found.get(fallback)?.[node.profile] : undefined;
			if (fallback && here) {
				// The profile's Device: only this computer has it.
				named.set(fallback.name, fallback);
				return { ...resolveAgentNode(node, here), device: fallback.name };
			}
			miss(node.profile, node.id, runDevice.thisDevice ? null : runDevice.name);
			return node;
		}),
	}));
	if (missing.size > 0) {
		throw new Error(
			[...missing]
				.map(([key, { nodeIds, on }]) => {
					const name = key.split("\u0000")[0];
					return on === null
						? `The flow uses the profile "${name}" (${nodeIds.join(", ")}), but no profile has that name. Add it under Agents.`
						: `The flow uses the profile "${name}" (${nodeIds.join(", ")}) on ${on}, but that device has no profile of that name. Add it under Agents.`;
				})
				.join(" "),
		);
	}
	return { flows: placed, named };
}

/**
 * Plans a run over the Devices it may use (`PlanDevices`), in the order the
 * person sees the refusals: the run's Device (it needs a Clone of the
 * project, unless it is this computer), the flow and its called flows from
 * that Clone, then each node's Device and profile. Every Device answers
 * for its own nodes afterwards: run start checks their requirements, the
 * devices' planner an offered Device's Offers.
 */
export async function planNodes(
	start: StartRunInput,
	devices: PlanDevices,
	personId: string | null,
): Promise<PlannedRun> {
	const { walker } = devices;
	let run = walker;
	if (start.deviceId !== undefined) {
		const found = await devices.byId(start.deviceId);
		if (!found) throw new Error(UNREACHABLE_DEVICE);
		run = found;
	}
	if (run !== walker && !run.hasClone) {
		throw new Error(
			`${run.name} does not have this project. Add its folder there first.`,
		);
	}
	const loaded = flowsForRun(await run.device.flows(start.projectId), start);
	const calledNames = Object.keys(loaded.calledFlows);
	const { flows, named } = await placeNodes(
		[loaded.flow, ...Object.values(loaded.calledFlows)],
		run,
		devices,
	);
	const [flow, ...called] = flows as [Flow, ...Flow[]];
	const groups = new Map<PlacedDevice, FlowNode[]>();
	for (const node of flows.flatMap((f) => f.nodes)) {
		const name = namedDevice(node);
		const at = name !== undefined ? (named.get(name) ?? run) : run;
		groups.set(at, [...(groups.get(at) ?? []), node]);
	}
	return {
		plan: {
			device: planned(run),
			named: Object.fromEntries(
				[...named].map(([name, at]) => [name, planned(at)]),
			),
			personId,
		},
		run,
		flow,
		flowName: loaded.flowName,
		calledFlows: Object.fromEntries(
			calledNames.map((name, i) => [name, called[i] as Flow]),
		),
		groups: [...groups].map(([at, nodes]) => ({ at, nodes })),
	};
}
