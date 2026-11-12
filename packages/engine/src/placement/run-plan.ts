import {
	calledFlowNames,
	cascadeProblem,
	deviceIdOf,
	type Flow,
	type FlowNode,
	type FlowSources,
	hasCascade,
	isProfileRef,
	legacyDeviceName,
	type ProfileRef,
	type ProfileSettings,
	profileOf,
	resolveNodeProfile,
	runsAs,
	tierUsers,
	withTierNode,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { DeviceProfile, StartRunInput } from "../contract";
import { flowsForRun } from "../flows";
import type { PlannedDevice } from "../log";
import { NOT_ON_THIS_COMPUTER } from "../projects";
import { chooseDevices, UNREACHABLE_DEVICE } from "./device-order";
import type { PlacedDevice, PlannedRun } from "./port";
import { checkAddresses } from "./start-addresses";

/**
 * The node walk of a run's plan: where each node runs, and its profile.
 * The Placement rule is written once here: a node's profile names its
 * Device (ADR 3), else the node's `device`, else the `device` of the
 * nearest Subflow around it (a Call node's, so a folder on one computer
 * syncs there whoever starts the run), else the run's Device. Every
 * Device by its id: a name only labels it (ADR 14). The walk applies the
 * Subflow's part (`bodyGraph`). Who the Devices are (the Person's own or
 * offered, online) is the caller's: the devices' planner
 * (`PlacementPort.plan`) passes its lookups, and so does the engine's own
 * fake of a computer alone.
 *
 * A profile is an Agent Profile for an Agent node, or a Model Profile for
 * a Decision or a Value decided by a model. A node with a cascade (ADR 6)
 * names one per tier: each tier is placed and resolved as a node of its
 * own (`runsAs`), so its tries run on its profile's Device. The run finds it on its own
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
	 * The Device a node runs on, by its id: the one its profile belongs to,
	 * or the one it names (`device`). This computer, one of the Person's
	 * other Devices, or another Person's through its Offers. Null when the
	 * Person cannot use a Device of that id in the Space. An offline one is
	 * `offline`: its steps wait for it. Throws a refusal of its own.
	 */
	nodeDevice(id: string): Promise<PlacedDevice | null>;
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
	/** The name of a Device by its id, for a refusal: one the Space no longer has too. Default: none. */
	deviceName?(deviceId: string): Promise<string | null>;
	/** The project's flows, from this Replica's flow document. */
	flows(projectId: string): Promise<FlowSources>;
	/** The Replica that keeps the Space: where a flow without a list runs (ADR 17). */
	keeperId?: string;
	/** The Host among the Devices, for the words of a move (`takenOverSecrets`). */
	hostId?: string;
	/** The Person's other Devices, for when no Device of the order can take the run. */
	lastResort?(): Promise<readonly string[]>;
	/** The profiles a run may use on a Device, by id. Null when unknown. */
	profilesOf?(deviceId: string): Promise<readonly DeviceProfile[] | null>;
};

export { UNREACHABLE_DEVICE };

/** The Device a node names by its id, if its kind runs on one. */
function namedDevice(node: FlowNode): string | undefined {
	return "device" in node ? deviceIdOf(node.device) : undefined;
}

/** A name from before ids that a node names as its Device, or null. */
function oldDeviceName(node: FlowNode): string | null {
	return "device" in node ? legacyDeviceName(node.device) : null;
}

const planned = (at: PlannedDevice): PlannedDevice => ({
	id: at.id,
	name: at.name,
});

/** An old profile's id is its name: the label when nothing better is known. */
function idAsName(ref: ProfileRef): string | null {
	return /^[a-z][a-z0-9_]{0,39}$/.test(ref.profile) ? ref.profile : null;
}

/**
 * Where each node runs, and its profile. Returns the flows with their
 * profiles resolved, the Devices the nodes name (`named`), and the Devices
 * of the profiles (`byId`), each by its id: a node with a profile runs on
 * its profile's Device, so two Devices of one name never take each
 * other's steps.
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
	// A cascade's tiers each name their own profile.
	const nodes = flows.flatMap((f) => f.nodes.flatMap(runsAs));
	const named = new Map<string, PlacedDevice>();
	const byId = new Map<string, PlacedDevice>();
	const unknown = new Map<string, string[]>();
	for (const node of nodes) {
		if (isProfileRef(profileOf(node))) continue;
		const oldName = oldDeviceName(node);
		if (oldName !== null) {
			// The flow check refuses it first: a run never starts on a guess.
			throw new Refusal(
				"invalid",
				`Node "${node.id}" names the device "${oldName}", but Night Shift cannot tell which device that is. Choose the device again.`,
			);
		}
		const id = namedDevice(node);
		if (id === undefined || named.has(id)) continue;
		const missing = unknown.get(id);
		if (missing) {
			if (!missing.includes(node.id)) missing.push(node.id);
			continue;
		}
		const found =
			id === runDevice.id
				? runDevice
				: id === devices.walker.id
					? devices.walker
					: await devices.nodeDevice(id);
		if (found) named.set(id, found);
		else unknown.set(id, [node.id]);
	}
	if (unknown.size > 0) {
		const words: string[] = [];
		for (const [id, nodeIds] of unknown) {
			const name = (await devices.deviceName?.(id)) ?? null;
			const which = nodeIds.map((nodeId) => `"${nodeId}"`).join(", ");
			words.push(
				name === null
					? `The flow runs ${which} on a device that is not in this Space, or that you cannot use. Choose another device.`
					: `The flow runs ${which} on ${name}, which is not in this Space, or that you cannot use. Choose another device.`,
			);
		}
		throw new Refusal("invalid", words.join(" "));
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
					: await devices.nodeDevice(ref.device),
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
	const placeOne = (node: FlowNode): FlowNode => {
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
	};
	const placed = flows.map((flow) => ({
		...flow,
		nodes: flow.nodes.map((node): FlowNode => {
			if (!hasCascade(node)) return placeOne(node);
			let climbing: FlowNode = node;
			for (const tier of tierUsers(node)) {
				const resolved = placeOne(tier.node);
				if (resolved !== tier.node) {
					climbing = withTierNode(climbing, tier.index, resolved);
				}
			}
			const problem = cascadeProblem(climbing);
			if (problem !== null && !misfits.includes(problem)) {
				misfits.push(problem);
			}
			return climbing;
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
 * devices' planner an offered Device's Offers. The nodes a test run pins
 * or skips (`start.test`, ADR 27) run on no Device: the plan places
 * neither them nor the flows only they call, so a pinned Agent needs no
 * harness and no profile. The flows it returns still have them.
 */
export async function planNodes(
	start: StartRunInput,
	devices: PlanDevices,
	personId: string | null,
	/** A person starts it: a Device the start names is their pick (ADR 17). */
	byPerson = true,
): Promise<PlannedRun> {
	const { walker } = devices;
	const loaded = flowsForRun(await devices.flows(start.projectId), start);
	// A test run's stand-ins run on no Device (ADR 27): the plan places the
	// other nodes, and the flows only they call.
	const standIns = standInIds(start);
	const root = withoutNodes(loaded.flow, standIns);
	const calledNames = calledFrom(root, loaded.calledFlows);
	const chosen = await chooseDevices(
		[root, ...calledNames.map((name) => loaded.calledFlows[name] as Flow)],
		start,
		byPerson,
		devices,
	);
	const { run } = chosen;
	if (run !== walker && !run.hasClone) {
		throw new Refusal(
			"conflict",
			`${run.name} does not have this project. Add its folder there first.`,
		);
	}
	if (run === walker && !walker.hasClone) {
		throw new Refusal("conflict", NOT_ON_THIS_COMPUTER);
	}
	const { flows, named, byId } = await placeNodes(chosen.flows, run, devices);
	const [placed, ...called] = flows as [Flow, ...Flow[]];
	const calledByName = new Map(
		calledNames.map((name, i) => [name, called[i] as Flow]),
	);
	// The run's flow has its stand-ins again, as the flow has them.
	const flow = withNodesOf(placed, loaded.flow, standIns);
	// Each node on its Device: its profile's, else its own, else the one
	// of the Subflow it runs in (a Call node that names a computer, the
	// nearest one), else the run's. A flow that two Subflows call on two
	// Devices has its nodes in both groups: each Device checks them.
	const groups = new Map<PlacedDevice, Set<FlowNode>>();
	const seen = new Set<string>();
	const group = (body: Flow, key: string, around: PlacedDevice) => {
		if (seen.has(`${key}\u0000${around.id}`)) return;
		seen.add(`${key}\u0000${around.id}`);
		// A cascade's tiers each go to their own Device.
		for (const node of body.nodes.flatMap(runsAs)) {
			const ref = profileOf(node);
			const id = namedDevice(node);
			const at = isProfileRef(ref)
				? (byId.get(ref.device) ?? run)
				: id !== undefined
					? (named.get(id) ?? run)
					: around;
			groups.set(at, (groups.get(at) ?? new Set()).add(node));
			if (node.type !== "call") continue;
			const inner = calledByName.get(node.flow);
			if (inner) group(inner, node.flow, at);
		}
	};
	group(placed, "", run);
	const offPlan = chosen.fallbacks
		? [...chosen.fallbacks.run, ...Object.values(chosen.fallbacks.nodes).flat()]
		: [];
	return {
		notes: chosen.notes,
		plan: {
			...(chosen.fallbacks ? { fallbacks: chosen.fallbacks } : {}),
			device: planned(run),
			named: Object.fromEntries(
				[...named].map(([id, at]) => [id, planned(at)]),
			),
			devices: Object.fromEntries(
				[...offPlan, run, ...named.values(), ...byId.values()].map((at) => [
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
		// A flow only a stand-in calls stays as loaded: it does not run.
		calledFlows: Object.fromEntries(
			Object.entries(loaded.calledFlows).map(([name, called]) => [
				name,
				calledByName.get(name) ?? called,
			]),
		),
		groups: [...groups].map(([at, nodes]) => ({ at, nodes: [...nodes] })),
	};
}

/** The nodes a test run's start pins or skips, by id (ADR 27). */
function standInIds(start: StartRunInput): ReadonlySet<string> {
	return new Set([
		...Object.keys(start.test?.pinned ?? {}),
		...Object.keys(start.test?.skipped ?? {}),
	]);
}

/** `flow` without the nodes of these ids: itself when there are none. */
function withoutNodes(flow: Flow, ids: ReadonlySet<string>): Flow {
	if (ids.size === 0) return flow;
	return { ...flow, nodes: flow.nodes.filter((node) => !ids.has(node.id)) };
}

/**
 * The placed flow with the nodes it left out (`ids`) back as `whole`
 * has them, in its order: itself when it left none out.
 */
function withNodesOf(
	placed: Flow,
	whole: Flow,
	ids: ReadonlySet<string>,
): Flow {
	if (ids.size === 0) return placed;
	const byId = new Map(placed.nodes.map((node) => [node.id, node]));
	return {
		...placed,
		nodes: whole.nodes.map((node) => byId.get(node.id) ?? node),
	};
}

/**
 * The names of the flows `root` calls, and the flows they call, in the
 * order of `called`: a flow only a left-out node calls is not among them.
 */
function calledFrom(root: Flow, called: Record<string, Flow>): string[] {
	const reached = new Set<string>();
	const visit = (flow: Flow) => {
		for (const node of flow.nodes) {
			// A Call's flow, and the flows of its cascade's tiers.
			const names = node.type === "call" ? calledFlowNames(node) : [];
			for (const name of names) {
				if (reached.has(name) || !Object.hasOwn(called, name)) continue;
				reached.add(name);
				visit(called[name] as Flow);
			}
		}
	};
	visit(root);
	return Object.keys(called).filter((name) => reached.has(name));
}
