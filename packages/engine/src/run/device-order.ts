import {
	deviceIdOf,
	type Flow,
	type FlowNode,
	fallbacksOf,
	hasCascade,
	isProfileRef,
	type ProfileRef,
	type ProfileSettings,
	profileOf,
	resolveNodeProfile,
	sameProfileRef,
	tierUsers,
	withTierNode,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { DeviceProfile, StartRunInput } from "../contract";
import type { Capabilities } from "../device";
import { kindOf } from "../graph";
import {
	type FallbackDevice,
	fallbackKey,
	type NodeFields,
	type RunFallbacks,
	takenOverSecrets,
} from "../log";
import type { PlacedDevice } from "./peers";

/**
 * Which Device takes a run's steps, in one order for every start (ADR 17):
 *
 * - A node with a profile runs on that profile's Device, then on the backups
 *   it lists (ADR 19). A profile always means its Device: Night Shift never
 *   looks for a profile of the same name on another Device. A pick only
 *   chooses among the profiles the node lists.
 * - Other steps take the Device a person picks, then the node's own Device,
 *   then the flow's list, then the Device the person started from. A flow
 *   without a list means the Host that keeps the Space.
 * - A schedule's or a webhook's run keeps its Device (ADR 15). Only a node
 *   that names a Device or a profile has fallbacks.
 *
 * A Device takes a step when it is online, has the project, and has what the
 * node needs.
 * This module rewrites the nodes it moves: `placeNodes` then places the
 * flow as if the flow had named those Devices itself. The Devices it passes
 * over stay in the plan, so a step can move when its Device goes offline.
 *
 * A Device that is not the first of its order takes the step over, and the
 * run warns about it.
 */

/** What the order asks of the Devices a run may use (`PlanDevices`). */
export type OrderDevices = {
	walker: PlacedDevice;
	byId(id: string): Promise<PlacedDevice | null>;
	/** A Device a node may name, by id (`PlanDevices.nodeDevice`). */
	nodeDevice(id: string): Promise<PlacedDevice | null>;
	/**
	 * The Person's other Devices that could take the run, for when no Device
	 * of the order can. Never a development install. Default: none.
	 */
	lastResort?(): Promise<readonly string[]>;
	/** The Replica that keeps the Space: the Host, else this computer. */
	keeperId?: string | undefined;
	/** The Host among the Devices: a step there reads no Personal secret. */
	hostId?: string | undefined;
	/** The profiles a run of the Person may use on a Device, by id. Null when unknown. */
	profilesOf?(deviceId: string): Promise<readonly DeviceProfile[] | null>;
	profileFor(id: string): ProfileSettings | null;
	lastKnown?(
		deviceId: string,
	): Promise<ReadonlyMap<
		string,
		{ name: string; settings: ProfileSettings }
	> | null>;
	/** What a Device has for these nodes (`capabilitiesFor`). */
	capabilities(
		at: PlacedDevice,
		nodes: readonly FlowNode[],
	): Promise<Capabilities>;
	/** The first requirement the nodes fail on those capabilities (`refusalOf`). */
	refusal(nodes: readonly FlowNode[], has: Capabilities): string | null;
};

/** A place a node may run: a Device, and for a node with a profile the pair. */
type Candidate = { id: string; pair: ProfileRef | null; node: FlowNode };

export type ChosenDevices = {
	/** The flows, with the nodes that moved naming their new Device. */
	flows: Flow[];
	/** The Device of every node that does not place itself. */
	run: PlacedDevice;
	fallbacks: RunFallbacks | null;
	/** What the person reads: each Device passed over, and why. */
	notes: string[];
};

/** The refusal of a Device this computer cannot reach: the devices' planner refuses with it too. */
export const UNREACHABLE_DEVICE =
	"That device cannot take runs from this computer. Pair it with this computer, or choose another device.";

const unique = (ids: readonly (string | null | undefined)[]): string[] => [
	...new Set(ids.filter((id): id is string => !!id)),
];

/** Whether a node says itself where it runs, and where. */
function pinOf(node: FlowNode): string | undefined {
	const ref = profileOf(node);
	if (isProfileRef(ref)) return ref.device;
	return "device" in node ? deviceIdOf(node.device) : undefined;
}

/** The fields a profile fills in, as a step on a fallback Device needs them. */
function fieldsOf(node: FlowNode): NodeFields {
	const picked: NodeFields = {};
	for (const key of [
		"harness",
		"model",
		"permissionMode",
		"effort",
		"clis",
		"connections",
		"decider",
		"address",
	] as const) {
		const value = (node as Record<string, unknown>)[key];
		if (value !== undefined) (picked as Record<string, unknown>)[key] = value;
	}
	return picked;
}

/** The nodes of a flow's nodes that run on the run's Device, in Subflows too. */
function unplacedOf(flows: readonly Flow[]): FlowNode[] {
	return flows.flatMap((flow) =>
		flow.nodes.filter(
			(node) =>
				!hasCascade(node) &&
				!isProfileRef(profileOf(node)) &&
				pinOf(node) === undefined,
		),
	);
}

export async function chooseDevices(
	flows: readonly Flow[],
	start: Pick<StartRunInput, "deviceId" | "startedFrom">,
	/** A person chose: `start.deviceId` is their pick, not a schedule's Host. */
	byPerson: boolean,
	devices: OrderDevices,
): Promise<ChosenDevices> {
	const { walker } = devices;
	const [flow] = flows as [Flow, ...Flow[]];
	const pick = byPerson ? start.deviceId : undefined;
	const configured = flow.devices?.length
		? flow.devices
		: [devices.keeperId ?? walker.id];
	const starter = byPerson ? (start.startedFrom ?? walker.id) : undefined;

	const notes: string[] = [];
	const known = new Map<string, Promise<PlacedDevice | null>>();
	const refusals = new Map<string, Refusal>();
	/** A Device by id, once per run. A Device this Person cannot use is null. */
	const placed = (id: string, ask: "run" | "node" = "run") => {
		let at = known.get(id);
		if (!at) {
			at = (
				id === walker.id
					? Promise.resolve(walker)
					: ask === "run"
						? devices.byId(id)
						: devices.nodeDevice(id)
			).catch((error: unknown) => {
				if (!(error instanceof Refusal)) throw error;
				refusals.set(id, error);
				return null;
			});
			known.set(id, at);
		}
		return at;
	};
	const capabilities = new Map<string, Promise<Capabilities>>();
	/** Why a Device cannot take these nodes now, or null when it can. */
	async function unfit(
		at: PlacedDevice,
		nodes: readonly FlowNode[],
	): Promise<string | null> {
		if (at.offline) return `${at.name} is offline`;
		if (
			!at.hasClone &&
			nodes.some((node) => kindOf(node).works(node) === "worktree")
		) {
			return `${at.name} does not have this project`;
		}
		if (at.offered) return null;
		let has = capabilities.get(at.id);
		if (!has) {
			has = devices.capabilities(
				at,
				flows.flatMap((f) => f.nodes),
			);
			capabilities.set(at.id, has);
		}
		// A Device this computer cannot reach cannot take the step either.
		const known = await has.catch((error: unknown) => {
			if (error instanceof Refusal) return null;
			throw error;
		});
		if (known === null) return `${at.name} cannot be reached`;
		const why = devices.refusal(nodes, known);
		return why === null ? null : `${at.name}: ${why}`;
	}

	// The run's Device: the first in the order that can take all its nodes.
	const runOrder = unique(
		!byPerson
			? [start.deviceId ?? walker.id]
			: [
					pick,
					...configured,
					starter,
					...((await devices.lastResort?.()) ?? []),
				],
	);
	const unplaced = unplacedOf(flows);
	let run: PlacedDevice | null = null;
	let firstPlaced: PlacedDevice | null = null;
	let firstPlacedId: string | null = null;
	let runId: string | null = null;
	const passedOver: string[] = [];
	for (const id of runOrder) {
		const at = await placed(id);
		if (!at) {
			// A pick that is not yours refuses. One that is offline moves on.
			const refusal = refusals.get(id);
			if (id === pick && refusal?.kind !== "unavailable") {
				throw refusal ?? new Refusal("invalid", UNREACHABLE_DEVICE);
			}
			continue;
		}
		firstPlaced ??= at;
		firstPlacedId ??= id;
		// Another Person's Device that offers nothing is no default.
		if (at.offered?.offers.length === 0 && id !== pick) continue;
		const why = await unfit(at, unplaced);
		if (why === null) {
			run = at;
			runId = id;
			break;
		}
		passedOver.push(why);
	}
	if (!run) {
		if (!firstPlaced) {
			const first = runOrder.flatMap((id) => refusals.get(id) ?? [])[0];
			throw first ?? new Refusal("invalid", UNREACHABLE_DEVICE);
		}
		// No Device fits: the first says why, or its steps wait for it.
		run = firstPlaced;
		runId = firstPlacedId;
	}
	const runTakenOver = runId !== runOrder[0];
	if (runTakenOver) {
		const why = passedOver.map((reason) => `${reason}. `).join("");
		notes.push(
			`${why}${run.name} takes over the run. ${takenOverSecrets(runId === devices.hostId)}`,
		);
	}

	const profilesOf = (id: string) =>
		devices.profilesOf?.(id) ?? Promise.resolve(null);

	/** A profile of a Device, by its id, as far as this computer can tell. */
	async function settingsOf(
		at: PlacedDevice,
		id: string,
	): Promise<ProfileSettings | null> {
		if (at.thisDevice) return devices.profileFor(id);
		if (at.offline) {
			return (await devices.lastKnown?.(at.id))?.get(id)?.settings ?? null;
		}
		return (
			(await at.device.capabilities({ profiles: [id] })).profiles[id] ?? null
		);
	}

	/** The name of the profile a node names, on the Device it names. */
	async function profileName(ref: ProfileRef): Promise<string> {
		const listed = (await profilesOf(ref.device))?.find(
			(p) => p.id === ref.profile,
		)?.name;
		return (
			listed ??
			(await devices.lastKnown?.(ref.device))?.get(ref.profile)?.name ??
			ref.profile
		);
	}

	/** Where a node may run, first one first. A profile means its Device (ADR 19). */
	function candidatesOf(node: FlowNode, pin: string): Candidate[] {
		const ref = profileOf(node);
		if (!isProfileRef(ref)) {
			return unique(
				!byPerson ? [pin, ...configured] : [pick, pin, ...configured, starter],
			).map((id) => ({
				id,
				pair: null,
				node: id === pin ? node : ({ ...node, device: id } as FlowNode),
			}));
		}
		const pairs = [ref, ...fallbacksOf(node)];
		// A pick only chooses among the profiles the node lists.
		return [
			...pairs.filter((pair) => pair.device === pick),
			...pairs.filter((pair) => pair.device !== pick),
		].map((pair) => ({
			id: pair.device,
			pair,
			node: sameProfileRef(pair, ref)
				? node
				: ({ ...node, profile: pair } as FlowNode),
		}));
	}

	/** Why a backup cannot be used at all, or null. A node's own profile is not asked. */
	async function unusableBackup(
		node: FlowNode,
		at: PlacedDevice,
		pair: ProfileRef,
	): Promise<string | null> {
		const own = profileOf(node);
		if (isProfileRef(own) && sameProfileRef(pair, own)) return null;
		if (at.offered) {
			return at.offered.offers.some((offer) => offer.profile === pair.profile)
				? null
				: `${at.name} does not offer "${await profileName(pair)}"`;
		}
		const has = (await profilesOf(at.id))?.some((p) => p.id === pair.profile);
		return has
			? null
			: `${at.name} has no profile "${await profileName(pair)}"`;
	}

	const fallbacks: Record<string, FallbackDevice[]> = {};
	/** A node that says where it runs: the first place of its order that can. */
	async function placeOne(node: FlowNode): Promise<FlowNode> {
		const pin = pinOf(node);
		if (pin === undefined) return node;
		const candidates = candidatesOf(node, pin);
		const unknownPin = !(await placed(pin, "node"));
		const options: { candidate: Candidate; at: PlacedDevice }[] = [];
		const reasons = new Map<Candidate, string>();
		for (const candidate of candidates) {
			const { id, pair } = candidate;
			const at = await placed(id, "node");
			if (!at) continue;
			if (pair) {
				const why = await unusableBackup(node, at, pair);
				if (why !== null) {
					reasons.set(candidate, why);
					continue;
				}
			} else if (at.offered && id !== pin && id !== pick) {
				// Another Person's Device: only the node's own, or the person's pick.
				continue;
			}
			options.push({ candidate, at });
		}
		let chosen: (typeof options)[number] | null = null;
		for (const option of options) {
			const why = await unfit(option.at, [option.candidate.node]);
			if (why === null) {
				chosen = option;
				break;
			}
			reasons.set(option.candidate, why);
		}
		// Nothing fits: the node's own says why, or its steps wait for it.
		const result = chosen?.candidate.node ?? node;
		const resultId = pinOf(result);
		if (chosen !== null && chosen.candidate !== candidates[0]) {
			// Only the places before the one that took it say why.
			const why = [
				...(unknownPin ? ["The device it names is not in this Space"] : []),
				...candidates
					.slice(0, candidates.indexOf(chosen.candidate))
					.flatMap((candidate) => reasons.get(candidate) ?? []),
			]
				.map((reason) => `${reason}. `)
				.join("");
			const taker = chosen.candidate.pair
				? `${await profileName(chosen.candidate.pair)} on ${chosen.at.name}`
				: chosen.at.name;
			notes.push(
				`${why}${taker} takes over node "${node.id}". ${takenOverSecrets(chosen.at.id === devices.hostId)}`,
			);
		}
		const needsClone = kindOf(node).works(node) === "worktree";
		const rest: FallbackDevice[] = [];
		for (const { at, candidate } of options) {
			const { pair } = candidate;
			if (at.id === resultId || at.offered) continue;
			if (needsClone && !at.hasClone) continue;
			const fallback: FallbackDevice = { id: at.id, name: at.name };
			if (pair) {
				const settings = await settingsOf(at, pair.profile);
				if (!settings) continue;
				const resolved = resolveNodeProfile(
					candidate.node,
					settings,
					await profileName(pair),
				);
				if ("problem" in resolved) continue;
				fallback.profile = pair;
				fallback.fields = fieldsOf(resolved.node);
			}
			rest.push(fallback);
		}
		if (rest.length > 0) fallbacks[fallbackKey(result)] = rest;
		return result;
	}

	const moved: Flow[] = [];
	for (const body of flows) {
		const nodes: FlowNode[] = [];
		for (const node of body.nodes) {
			if (!hasCascade(node)) {
				nodes.push(await placeOne(node));
				continue;
			}
			let climbing: FlowNode = node;
			for (const tier of tierUsers(node)) {
				const next = await placeOne(tier.node);
				if (next !== tier.node) {
					climbing = withTierNode(climbing, tier.index, next);
				}
			}
			nodes.push(climbing);
		}
		moved.push({ ...body, nodes });
	}

	// A Service stays on the Device it started on, and so do the steps that use it.
	const holdsService = flows.some((f) =>
		f.nodes.some((node) => node.type === "service"),
	);
	const runRest: FallbackDevice[] = [];
	if (byPerson) {
		for (const id of runOrder) {
			const at = await placed(id);
			if (!at || at.id === run.id || at.offered || !at.hasClone) continue;
			runRest.push({ id: at.id, name: at.name });
		}
	}
	const any = runRest.length > 0 || Object.keys(fallbacks).length > 0;
	return {
		flows: moved,
		run,
		fallbacks:
			any && !holdsService
				? {
						run: runRest,
						nodes: fallbacks,
						...(devices.hostId ? { hostId: devices.hostId } : {}),
					}
				: null,
		notes,
	};
}
