import {
	type Flow,
	type FlowNode,
	type ProfileIssue,
	type ProfileSettings,
	type ProfilesSource,
	parseProfilesSource,
	profileOf,
	resolveNodeProfile,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { StartRunInput } from "../contract";
import { flowsForRun } from "../flows";
import type { PlannedDevice } from "../log";
import type { PlacedDevice, PlannedRun } from "./peers";

/**
 * The node walk of a run's plan: where each node runs, and its profile.
 * The Placement rule is written once here: a node's `device`, else its
 * profile's Device (the run's Device when it has the profile or the
 * project has it, else this computer when only it has it), else the run's
 * Device. Who the Devices are (the Person's own or offered, online, by
 * name) is the caller's: the devices' planner (`PlacementPort.plan`)
 * passes its lookups, and so does the engine's own fake of a computer
 * alone.
 *
 * A profile is an Agent Profile for an Agent node, or a Model Profile for
 * a Decision or a Value decided by a model. A Device's own profile of a
 * name wins over the project's (`.nightshift/profiles.json` in the run's
 * Clone), so a person can change a project's profile on their computer.
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
	 * when there is none of that name. An offline one is `offline`: its
	 * steps wait for it. Throws a refusal of its own (two of that name).
	 */
	byName(name: string): Promise<PlacedDevice | null>;
	/** A profile of this computer by name, or null. */
	profileFor(name: string): ProfileSettings | null;
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

/** The project's profiles, from the profiles file of the run's Clone. */
type ProjectProfileSet = {
	byName: Record<string, ProfileSettings>;
	/** Why the file gives fewer profiles than it holds. */
	issues: ProfileIssue[];
};

/**
 * Reads the project's profiles from the run's Device. A Device that cannot
 * answer (one from before project profiles) gives none.
 */
async function projectProfiles(
	run: PlacedDevice,
	projectId: string,
): Promise<ProjectProfileSet> {
	let source: ProfilesSource = null;
	try {
		source = await run.device.projectProfiles(projectId);
	} catch {
		// None: the flows came from this Clone, so it answers when it can.
	}
	const { profiles, issues } = parseProfilesSource(source);
	return {
		byName: Object.fromEntries(
			profiles.map(({ name, description: _description, ...settings }) => [
				name,
				settings,
			]),
		),
		issues,
	};
}

/**
 * Where each node runs, and its profile. Returns the flows with their
 * profiles resolved, a node that runs on this computer for its profile
 * named so, and the Devices by name.
 */
async function placeNodes(
	flows: readonly Flow[],
	runDevice: PlacedDevice,
	devices: PlanDevices,
	project: ProjectProfileSet,
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
			throw new Refusal(
				"invalid",
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
		const profile = profileOf(node);
		if (profile === undefined) continue;
		const name = namedDevice(node);
		const at =
			name !== undefined ? (named.get(name) as PlacedDevice) : runDevice;
		if (!at.offered) want(at, profile);
		if (name === undefined && fallback) want(fallback, profile);
	}
	const found = new Map<PlacedDevice, Record<string, ProfileSettings>>();
	for (const [at, names] of wanted) {
		// An offline Device cannot say which profiles it has.
		if (at.offline) continue;
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
	// A profile that does not fit its node: an Agent on a Model Profile, a
	// Decision on an Agent Profile, a Value on a decider that cannot make one.
	const misfits: string[] = [];
	const offlineProfiles: string[] = [];
	const resolve = (node: FlowNode, profile: ProfileSettings): FlowNode => {
		const resolved = resolveNodeProfile(node, profile);
		if ("node" in resolved) return resolved.node;
		if (!misfits.includes(resolved.problem)) misfits.push(resolved.problem);
		return node;
	};
	const placed = flows.map((flow) => ({
		...flow,
		nodes: flow.nodes.map((node): FlowNode => {
			const profile = profileOf(node);
			if (profile === undefined) return node;
			const fromProject = Object.hasOwn(project.byName, profile)
				? project.byName[profile]
				: undefined;
			const name = namedDevice(node);
			const placedAt =
				name !== undefined ? (named.get(name) as PlacedDevice) : runDevice;
			// Offered: the run's copy never holds the profile's settings.
			if (placedAt.offered) return node;
			if (name !== undefined) {
				const at = named.get(name) as PlacedDevice;
				const settings = found.get(at)?.[profile] ?? fromProject;
				if (!settings && at.offline) {
					offlineProfiles.push(
						`${at.name} is offline, so Night Shift cannot find its profile "${profile}" (${node.id}). Start the run when it is online.`,
					);
					return node;
				}
				if (!settings) {
					miss(profile, node.id, at.thisDevice ? null : at.name);
					return node;
				}
				return resolve(node, settings);
			}
			const own = found.get(runDevice)?.[profile];
			if (own) return resolve(node, own);
			// The project's profile runs on the run's Device: it has the project.
			if (fromProject) return resolve(node, fromProject);
			const here = fallback ? found.get(fallback)?.[profile] : undefined;
			if (fallback && here) {
				// The profile's Device: only this computer has it.
				named.set(fallback.name, fallback);
				return { ...resolve(node, here), device: fallback.name } as FlowNode;
			}
			miss(profile, node.id, runDevice.thisDevice ? null : runDevice.name);
			return node;
		}),
	}));
	if (missing.size > 0) {
		// A broken profiles file explains a profile the project should have.
		const fileProblem =
			project.issues.length > 0
				? ` The project's profiles have a problem: ${project.issues.map((i) => i.message).join(" ")}`
				: "";
		throw new Refusal(
			"invalid",
			[...missing]
				.map(([key, { nodeIds, on }]) => {
					const name = key.split("\u0000")[0];
					return on === null
						? `The flow uses the profile "${name}" (${nodeIds.join(", ")}), but no profile has that name. Add it under Agents, or to the project's profiles.`
						: `The flow uses the profile "${name}" (${nodeIds.join(", ")}) on ${on}, but that device has no profile of that name. Add it under Agents, or to the project's profiles.`;
				})
				.join(" ") + fileProblem,
		);
	}
	if (misfits.length > 0) throw new Refusal("invalid", misfits.join(" "));
	if (offlineProfiles.length > 0) {
		throw new Refusal("unavailable", offlineProfiles.join(" "));
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
		if (!found) throw new Refusal("invalid", UNREACHABLE_DEVICE);
		run = found;
	}
	if (run !== walker && !run.hasClone) {
		throw new Refusal(
			"conflict",
			`${run.name} does not have this project. Add its folder there first.`,
		);
	}
	const loaded = flowsForRun(await run.device.flows(start.projectId), start);
	const calledNames = Object.keys(loaded.calledFlows);
	const { flows, named } = await placeNodes(
		[loaded.flow, ...Object.values(loaded.calledFlows)],
		run,
		devices,
		await projectProfiles(run, start.projectId),
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
		flowRevision: loaded.flowRevision,
		calledFlowRevisions: loaded.calledFlowRevisions,
		calledFlows: Object.fromEntries(
			calledNames.map((name, i) => [name, called[i] as Flow]),
		),
		groups: [...groups].map(([at, nodes]) => ({ at, nodes })),
	};
}
