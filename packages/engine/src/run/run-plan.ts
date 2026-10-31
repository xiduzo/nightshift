import {
	type Flow,
	type FlowNode,
	type FlowSources,
	isProfileRef,
	type ProfileRef,
	type ProfileSettings,
	profileOf,
	resolveNodeProfile,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { StartRunInput } from "../contract";
import { flowsForRun } from "../flows";
import type { PlannedDevice } from "../log";
import { NOT_ON_THIS_COMPUTER } from "../projects";
import type { PlacedDevice, PlannedRun } from "./peers";
import { checkAddresses } from "./start-addresses";

/**
 * The node walk of a run's plan: where each node runs, and its profile.
 * The Placement rule is written once here: a node's profile names its
 * Device (ADR 3), else the node's `device`, else the `device` of the
 * nearest Subflow around it (a Call node's, so a folder on one computer
 * syncs there whoever starts the run), else the run's Device. The walk
 * applies the Subflow's part (`bodyGraph`). Who the
 * Devices are (the Person's own or offered, online, by id or by name) is
 * the caller's: the devices' planner (`PlacementPort.plan`) passes its
 * lookups, and so does the engine's own fake of a computer alone.
 *
 * A profile is an Agent Profile for an Agent node, or a Model Profile for
 * a Decision or a Value decided by a model. The run finds it on its own
 * Device, by its id: never another Device's profile of the same name.
 * When that Device is offline, the run starts from the profile as the
 * Device's document last said, and the step waits for the Device (ADR 1,
 * decision 11).
 */

/** What the node walk asks of the Devices a run may use. */
export type PlanDevices = {
	/** This computer: the Walker. */
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
	 * when there is none of that name. An offline one is `offline`: its
	 * steps wait for it. Throws a refusal of its own (two of that name).
	 */
	byName(name: string): Promise<PlacedDevice | null>;
	/**
	 * The Device a node's profile belongs to, by its id: this computer, one
	 * of the Person's other Devices, or another Person's through its Offers.
	 * Null when the Person cannot use a Device of that id in the Space. An
	 * offline one is `offline`. Throws a refusal of its own.
	 */
	profileDevice(id: string): Promise<PlacedDevice | null>;
	/** A profile of this computer by its id, or null. */
	profileFor(id: string): ProfileSettings | null;
	/**
	 * Another Device's profiles as its document last said, by id, with
	 * their names (`lastKnownProfiles`): what a node on an offline Device
	 * starts with. Null when this computer has no copy. Default: none.
	 */
	lastKnown?(
		deviceId: string,
	): Promise<ReadonlyMap<
		string,
		{ name: string; settings: ProfileSettings }
	> | null>;
	/** The last name of a Device the Space no longer has, for the refusal. Default: none. */
	deviceName?(deviceId: string): Promise<string | null>;
	/** The project's flows, from this Replica's flow document. */
	flows(projectId: string): Promise<FlowSources>;
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

/** An old profile's id is its name: the label when nothing better is known. */
function idAsName(ref: ProfileRef): string | null {
	return /^[a-z][a-z0-9_]{0,39}$/.test(ref.profile) ? ref.profile : null;
}

/**
 * Where each node runs, and its profile. Returns the flows with their
 * profiles resolved, the Devices the nodes name by their name (`named`),
 * and the Devices of the profiles by id (`byId`): a node with a profile
 * runs on its profile's Device, by the id its profile names, so two
 * Devices of one name never take each other's steps.
 */
async function placeNodes(
	flows: readonly Flow[],
	runDevice: PlacedDevice,
	devices: PlanDevices,
): Promise<{
	flows: Flow[];
	named: Map<string, PlacedDevice>;
	byId: Map<string, PlacedDevice>;
}> {
	const nodes = flows.flatMap((f) => f.nodes);
	const named = new Map<string, PlacedDevice>();
	const byId = new Map<string, PlacedDevice>();
	for (const node of nodes) {
		const name = namedDevice(node);
		if (name === undefined || named.has(name)) continue;
		if (isProfileRef(profileOf(node))) continue;
		if (name === runDevice.name) {
			named.set(name, runDevice);
			continue;
		}
		const found = await devices.byName(name);
		if (!found) {
			throw new Refusal(
				"invalid",
				`The flow names the device "${name}", but you have no device of that name, and none of that name offers profiles to this Space. Check the node's device.`,
			);
		}
		named.set(name, found);
	}

	// The Device of each profile, by its id: null when the Space has none.
	const owners = new Map<string, PlacedDevice | null>();
	for (const node of nodes) {
		const ref = profileOf(node);
		if (!isProfileRef(ref) || owners.has(ref.device)) continue;
		owners.set(
			ref.device,
			ref.device === runDevice.id
				? runDevice
				: ref.device === devices.walker.id
					? devices.walker
					: await devices.profileDevice(ref.device),
		);
	}
	const wanted = new Map<PlacedDevice, Set<string>>();
	for (const node of nodes) {
		const ref = profileOf(node);
		if (!isProfileRef(ref)) continue;
		const at = owners.get(ref.device);
		// Another Person's Device resolves its offered profiles itself.
		if (!at || at.offered) continue;
		const set = wanted.get(at) ?? new Set();
		set.add(ref.profile);
		wanted.set(at, set);
	}
	const found = new Map<PlacedDevice, Record<string, ProfileSettings>>();
	const lastKnownOf = new Map<
		string,
		Promise<ReadonlyMap<
			string,
			{ name: string; settings: ProfileSettings }
		> | null>
	>();
	const lastKnown = (deviceId: string) => {
		let known = lastKnownOf.get(deviceId);
		if (!known) {
			known = devices.lastKnown?.(deviceId) ?? Promise.resolve(null);
			lastKnownOf.set(deviceId, known);
		}
		return known;
	};
	for (const [at, ids] of wanted) {
		if (at.offline) {
			// Its profiles as its document last said: its steps wait for it.
			const known = await lastKnown(at.id);
			found.set(
				at,
				Object.fromEntries(
					[...ids].flatMap((id) => {
						const profile = known?.get(id);
						return profile ? [[id, profile.settings]] : [];
					}),
				),
			);
			continue;
		}
		found.set(
			at,
			at.thisDevice
				? Object.fromEntries(
						[...ids].flatMap((id) => {
							const profile = devices.profileFor(id);
							return profile ? [[id, profile]] : [];
						}),
					)
				: (await at.device.capabilities({ profiles: [...ids] })).profiles,
		);
	}

	// What a refusal calls a profile: its name as its Device last said.
	const labels = new Map<string, string | null>();
	for (const node of nodes) {
		const ref = profileOf(node);
		if (!isProfileRef(ref)) continue;
		const key = `${ref.device}\u0000${ref.profile}`;
		if (labels.has(key)) continue;
		const known = (await lastKnown(ref.device))?.get(ref.profile)?.name;
		labels.set(key, known ?? idAsName(ref));
	}
	const labelOf = (ref: ProfileRef) =>
		labels.get(`${ref.device}\u0000${ref.profile}`) ?? null;

	const problems = new Map<string, string[]>();
	const wordsOf = new Map<string, (nodeIds: string) => string>();
	const problem = (
		words: (nodeIds: string) => string,
		key: string,
		nodeId: string,
	) => {
		const entry = problems.get(key) ?? [];
		if (!entry.includes(nodeId)) problems.set(key, [...entry, nodeId]);
		wordsOf.set(key, words);
	};
	const gone = new Map<string, string | null>();
	for (const [deviceId, at] of owners) {
		if (at === null)
			gone.set(deviceId, (await devices.deviceName?.(deviceId)) ?? null);
	}
	// A profile that does not fit its node: an Agent on a Model Profile, a
	// Decision on an Agent Profile, a Value on a decider that cannot make one.
	const misfits: string[] = [];
	const placed = flows.map((flow) => ({
		...flow,
		nodes: flow.nodes.map((node): FlowNode => {
			const ref = profileOf(node);
			if (!isProfileRef(ref)) return node;
			const at = owners.get(ref.device);
			if (!at) {
				const name = gone.get(ref.device) ?? null;
				problem(
					(ids) =>
						name === null
							? `The flow uses a profile of a device that is no longer in this Space (${ids}). Pick another profile.`
							: `${name} is no longer in this Space. Pick another profile for ${ids}.`,
					`gone\u0000${ref.device}`,
					node.id,
				);
				return node;
			}
			// Offered: the run's copy never holds the profile's settings.
			if (at.offered) {
				byId.set(at.id, at);
				return node;
			}
			const label = labelOf(ref);
			const settings = found.get(at)?.[ref.profile];
			if (!settings) {
				problem(
					(ids) =>
						at.offline
							? `${at.name} is offline, and Night Shift does not know ${label === null ? "its profile" : `its profile ${label}`} (${ids}). Start the run when ${at.name} is online, or pick another profile.`
							: label === null
								? `The flow uses a profile on ${at.name} (${ids}) that ${at.name} no longer has. Pick another profile.`
								: `The flow uses ${label} on ${at.name} (${ids}), but ${at.name} has no such profile. Pick another profile.`,
					`missing\u0000${ref.device}\u0000${ref.profile}`,
					node.id,
				);
				return node;
			}
			const resolved = resolveNodeProfile(node, settings, label ?? undefined);
			if ("problem" in resolved) {
				if (!misfits.includes(resolved.problem)) {
					misfits.push(resolved.problem);
				}
				return node;
			}
			byId.set(at.id, at);
			return resolved.node;
		}),
	}));
	if (problems.size > 0) {
		throw new Refusal(
			"invalid",
			[...problems]
				.map(([key, nodeIds]) =>
					(wordsOf.get(key) as (ids: string) => string)(nodeIds.join(", ")),
				)
				.join(" "),
		);
	}
	if (misfits.length > 0) throw new Refusal("invalid", misfits.join(" "));
	await checkAddresses(placed, owners, labelOf);
	return { flows: placed, named, byId };
}

/**
 * Plans a run over the Devices it may use (`PlanDevices`), in the order the
 * person sees the refusals: the run's Device (it needs a Clone of the
 * project, unless it is this computer), the flow and its called flows from
 * the flow document, then each node's Device and profile. Every Device answers
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
		if (!found) throw new Refusal("invalid", UNREACHABLE_DEVICE);
		run = found;
	} else if (start.deviceName !== undefined) {
		const found = await devices.byName(start.deviceName);
		if (!found) {
			throw new Refusal(
				"invalid",
				`There is no device named "${start.deviceName}" in this Space. Choose another device for this schedule.`,
			);
		}
		run = found;
	}
	if (run !== walker && !run.hasClone) {
		throw new Refusal(
			"conflict",
			`${run.name} does not have this project. Add its folder there first.`,
		);
	}
	if (run === walker && !walker.hasClone) {
		throw new Refusal("conflict", NOT_ON_THIS_COMPUTER);
	}
	const loaded = flowsForRun(await devices.flows(start.projectId), start);
	const calledNames = Object.keys(loaded.calledFlows);
	const { flows, named, byId } = await placeNodes(
		[loaded.flow, ...Object.values(loaded.calledFlows)],
		run,
		devices,
	);
	const [flow, ...called] = flows as [Flow, ...Flow[]];
	const calledByName = new Map(
		calledNames.map((name, i) => [name, called[i] as Flow]),
	);
	// Each node on its Device: its profile's, else its own, else the one
	// of the Subflow it runs in (a Call node that names a computer, the
	// nearest one), else the run's. A flow that two Subflows call on two
	// Devices has its nodes in both groups: each Device checks them.
	const groups = new Map<PlacedDevice, Set<FlowNode>>();
	const seen = new Set<string>();
	const group = (body: Flow, key: string, around: PlacedDevice) => {
		if (seen.has(`${key}\u0000${around.id}`)) return;
		seen.add(`${key}\u0000${around.id}`);
		for (const node of body.nodes) {
			const ref = profileOf(node);
			const name = namedDevice(node);
			const at = isProfileRef(ref)
				? (byId.get(ref.device) ?? run)
				: name !== undefined
					? (named.get(name) ?? run)
					: around;
			groups.set(at, (groups.get(at) ?? new Set()).add(node));
			if (node.type !== "call") continue;
			const inner = calledByName.get(node.flow);
			if (inner) group(inner, node.flow, at);
		}
	};
	group(flow, "", run);
	return {
		plan: {
			device: planned(run),
			named: Object.fromEntries(
				[...named].map(([name, at]) => [name, planned(at)]),
			),
			devices: Object.fromEntries(
				[run, ...named.values(), ...byId.values()].map((at) => [
					at.id,
					planned(at),
				]),
			),
			personId,
		},
		run,
		flow,
		flowName: loaded.flowName,
		flowRevision: loaded.flowRevision,
		calledFlowRevisions: loaded.calledFlowRevisions,
		calledFlows: Object.fromEntries(calledByName),
		groups: [...groups].map(([at, nodes]) => ({ at, nodes: [...nodes] })),
	};
}
