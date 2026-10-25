import type { Database } from "@nightshift/db";
import {
	type Actor,
	type Device,
	HostUnreachableError,
	type ListedProject,
	NOT_ON_THIS_COMPUTER,
	type NodeToPlace,
	type OfferedPlacement,
	type OwnDevice,
	type PlacedDevice,
	type Placement,
	type PlanDevices,
	type PlanInput,
	type PlannedRun,
	planNodes,
	planOf,
	projectClones,
	type RunLog,
	type RunRow,
	type SpaceDocuments,
	UNREACHABLE_DEVICE,
} from "@nightshift/engine";
import type { AgentProfileSettings, FlowNode } from "@nightshift/flows";
import type { FlowSources } from "@nightshift/flows/files";
import { Refusal } from "@nightshift/refusal";
import type { HostRelay, WorkRelay } from "../contract";
import { type HostSpaces, personInSpace } from "../links";
import {
	type DeviceOffer,
	NO_STARTER,
	offerRefusal,
	offersNothing,
	offerTakes,
	spaceOffers,
} from "../offers";
import { type DeviceRegistry, selfOwnerId } from "../registry";
import { remoteDevice } from "../work";

/**
 * Placement: where a run's steps run, decided once when it starts. One
 * module owns both halves:
 *
 * - At run start (`plan`): the Person the run runs for, as the Host of its
 *   Space knows them; the run's Device (`deviceId`, else this computer);
 *   and each node's Device, by the engine's node walk (`planNodes`: its
 *   `device`, else its profile's Device, else the run's) over this
 *   module's Devices. Each Device is checked: one of the Person's own, or
 *   another Person's through its Offers into the Space (the nodes placed
 *   there stay within them, `offerRefusal`), online, with a Clone where
 *   it needs one. On the Replica that keeps the Space the registry
 *   answers; on a Device in a Host's Space the Host does
 *   (`HostRelay.devices`). Run start keeps the plan on the run's row.
 * - While the run walks (`deviceFor`): the plan, read from the row
 *   (`planOf`), and nothing decided again. Another Device is a
 *   `remoteDevice` over the work relay, named as the plan names it.
 *
 * The placed Device checks every call again itself.
 */

export type PlacementDeps = {
	db: Database;
	/** This computer as a Device. */
	device: Device;
	log: RunLog;
	registry: DeviceRegistry;
	documents: SpaceDocuments;
	hostSpaces: HostSpaces;
	/** A project a person has not removed, with its Clone here or null. */
	project(projectId: string, spaceId: string): Promise<ListedProject>;
	/** An Agent Profile of this computer by name. Default: none. */
	profileFor?: (name: string) => AgentProfileSettings | null;
	/** How calls reach other Devices. Without it, every step runs here. */
	work?: WorkRelay;
	/** The Hosts this computer links to. */
	relay?: HostRelay;
	/**
	 * This computer for a step of a run: itself, or for another Person's
	 * run, itself through its Offer admission (`OfferAdmission.deviceFor`).
	 * Default: itself.
	 */
	localFor?(row: RunRow): Device;
	/** This computer's own Offers into a Space that are in force. Default: none. */
	offersHere?(spaceId: string): Promise<DeviceOffer[]>;
	/** Whether a Person's role in a Space uses Offers. Default: nobody's. */
	mayUseOffers?(spaceId: string, personId: string): Promise<boolean>;
};

export type PlacementModule = ReturnType<typeof createPlacement>;

/** A work relay that reaches nobody. */
const UNREACHABLE: WorkRelay = {
	async *call() {
		yield {
			kind: "error",
			message: "This computer cannot reach the device this step is placed on.",
			offline: true,
		};
	},
	online: () => false,
};

/** A run with no starter: nothing is sent, and every call is refused here. */
const NO_STARTER_RELAY: WorkRelay = {
	async *call() {
		yield { kind: "error", message: NO_STARTER };
	},
	online: () => true,
};

/** The Device a node names, if its kind runs on one. */
function nodeDevice(node: FlowNode): string | undefined {
	return "device" in node ? node.device : undefined;
}

/**
 * The Device a name picks among the Devices a Person may use: a name of
 * one of their own wins over another Person's. Null when none has it.
 * Throws when two of them have it.
 */
export function deviceNamed(
	devices: readonly OwnDevice[],
	name: string,
): OwnDevice | null {
	const all = devices.filter((d) => d.name === name);
	// One of their own wins, then this computer, then another Person's.
	const own = all.filter((d) => d.offers === undefined);
	const here = all.filter((d) => d.thisDevice);
	const matches = own.length > 0 ? own : here.length > 0 ? here : all;
	if (matches.length > 1) {
		throw new Refusal(
			"conflict",
			`Two of your devices are named "${name}". Rename one on the Devices page.`,
		);
	}
	return matches[0] ?? null;
}

export function createPlacement(deps: PlacementDeps) {
	const { db, device, registry, documents, hostSpaces } = deps;
	const work = deps.work ?? UNREACHABLE;

	/** Whether an id is this computer. */
	async function isHere(id: string): Promise<boolean> {
		return id === device.id || id === (await deps.log.walkerId());
	}

	/** The Device a step of `node` runs on, as the run's plan says. */
	function deviceFor(node: FlowNode, row: RunRow): Device {
		const plan = planOf(row);
		const name = nodeDevice(node);
		const at =
			(name !== undefined ? plan.named[name] : undefined) ?? plan.device;
		return deviceById(at.id, row, at.name ?? name);
	}

	/** A Device by id, for a step of the run: this computer, or another Device of its plan. */
	function deviceById(id: string, row: RunRow, named?: string): Device {
		if (id === device.id || id === row.walkerId) {
			return deps.localFor?.(row) ?? device;
		}
		const plan = planOf(row);
		const name =
			[plan.device, ...Object.values(plan.named)].find((d) => d.id === id)
				?.name ?? named;
		return remoteDevice(
			plan.personId === null ? NO_STARTER_RELAY : work,
			{ id, name: name ?? "The device of this step" },
			{
				spaceId: row.spaceId,
				projectId: row.projectId,
				personId: plan.personId ?? "",
				runId: row.id,
			},
		);
	}

	/** The Person who owns this computer, as the Space's Host knows them. */
	async function ownerHere(spaceId: string): Promise<string | null> {
		return personInSpace(db, spaceId, await selfOwnerId(db));
	}

	/**
	 * A Person's Devices for a project of a Space: this computer first,
	 * then their other Devices, each with whether it is online and has a
	 * Clone. The Replica that keeps the Space asks its registry; a Device
	 * in a Host's Space asks the Host.
	 */
	async function ownDevices(
		spaceId: string,
		personId: string,
		projectId: string,
	): Promise<OwnDevice[]> {
		const project = await deps.project(projectId, spaceId);
		const self = await deps.log.walkerId();
		const here: OwnDevice = {
			deviceId: self,
			name: device.name,
			thisDevice: true,
			online: true,
			hasClone: project.repoPath !== null,
		};
		if ((await hostSpaces.hostOf(spaceId)) !== null) {
			// The Host cannot be reached: the list shows this computer only.
			const listed = deps.relay
				? await deps.relay
						.devices({ spaceId, projectId })
						.catch((error: unknown) => {
							if (error instanceof HostUnreachableError) return [];
							throw error;
						})
				: [];
			return [
				here,
				...listed
					.filter((d) => d.deviceId !== self)
					.map((d) => ({ ...d, thisDevice: false })),
			];
		}
		const withClone = new Set(
			projectClones(await documents.open(spaceId), projectId).map(
				(c) => c.deviceId,
			),
		);
		const own: OwnDevice[] = [];
		for (const d of await registry.list(personId)) {
			if (d.revokedAt !== null || d.id === self) continue;
			own.push({
				deviceId: d.id,
				name: d.name,
				thisDevice: false,
				online: await work.online(d.id, spaceId),
				hasClone: withClone.has(d.id),
			});
		}
		return [here, ...own];
	}

	/**
	 * Other Persons' Devices that offer profiles to the Space, from its
	 * document (the keeping Replica's, or the copy a Host syncs here):
	 * each with its offered profiles, whether it takes work and has a
	 * Clone. This computer, for a Person who does not own it, with its own
	 * Offers.
	 */
	async function offeredDevices(
		spaceId: string,
		personId: string,
		projectId: string,
		own: readonly OwnDevice[],
	): Promise<OwnDevice[]> {
		const document = await documents.open(spaceId);
		const withClone = new Set(
			projectClones(document, projectId).map((c) => c.deviceId),
		);
		const mine = new Set(own.map((d) => d.deviceId));
		const self = await deps.log.walkerId();
		const byDevice = new Map<string, { name: string; offers: string[] }>();
		for (const offer of spaceOffers(document)) {
			if (offer.deviceId === self || offer.deviceId === device.id) continue;
			if (mine.has(offer.deviceId)) continue;
			const entry = byDevice.get(offer.deviceId) ?? {
				name: offer.deviceName,
				offers: [],
			};
			entry.offers.push(offer.profile);
			byDevice.set(offer.deviceId, entry);
		}
		const others: OwnDevice[] = [];
		for (const [id, { name, offers }] of byDevice) {
			const paired = await registry.get(id);
			if (
				paired &&
				(paired.revokedAt !== null || paired.ownerId === personId)
			) {
				continue;
			}
			others.push({
				deviceId: id,
				name: paired?.name ?? name,
				thisDevice: false,
				offers,
				online: await work.online(id, spaceId),
				hasClone: withClone.has(id),
			});
		}
		return others;
	}

	/**
	 * The Devices a Person may place a run's steps on: their own (this
	 * computer first), then other Persons' that offer profiles to the
	 * Space. This computer carries `offers` when the Person does not own it.
	 * With `forNode`, the Devices that node may name: another Person's only
	 * when it takes the node through its Offers (`offerTakes`).
	 */
	async function devicesFor(
		spaceId: string,
		personId: string,
		projectId: string,
		forNode?: NodeToPlace,
	): Promise<OwnDevice[]> {
		const own = await ownDevices(spaceId, personId, projectId);
		const [here, ...rest] = own as [OwnDevice, ...OwnDevice[]];
		// In a Host's Space, this computer's Person is the one who asks here.
		const owner = await ownerHere(spaceId);
		const asking = await personInSpace(db, spaceId, personId);
		const thisOne: OwnDevice =
			owner === asking
				? here
				: {
						...here,
						offers: ((await deps.offersHere?.(spaceId)) ?? []).map(
							(o) => o.profile,
						),
					};
		const all = [
			thisOne,
			...rest,
			...(await offeredDevices(spaceId, personId, projectId, own)),
		];
		if (!forNode) return all;
		const mayUse = (await deps.mayUseOffers?.(spaceId, asking)) ?? false;
		return all.filter(
			(d) => d.offers === undefined || offerTakes(forNode, d.offers, mayUse),
		);
	}

	/** The Device a name picks for a Person, over one list of their Devices (`deviceNamed`). */
	async function namesFor(
		spaceId: string,
		personId: string,
		projectId: string,
	): Promise<(name: string) => OwnDevice | null> {
		const devices = await devicesFor(spaceId, personId, projectId);
		return (name) => deviceNamed(devices, name);
	}

	/** The Devices a run of the project can run on: online, with a Clone. */
	async function placements(
		spaceId: string,
		personId: string,
		projectId: string,
	): Promise<Placement[]> {
		return (await devicesFor(spaceId, personId, projectId))
			.filter((d) => d.online && d.hasClone)
			.map(({ deviceId, name, thisDevice, offers }) => ({
				deviceId,
				name,
				thisDevice,
				...(offers ? { offers } : {}),
			}));
	}

	/**
	 * The Devices a run of the project may use, for the Person it runs
	 * for: this computer (through its Offers, for another Person's run),
	 * and the others by id or by name, each checked first: the Person's
	 * own, or another Person's through its Offers, online.
	 */
	async function devicesOf(
		project: ListedProject,
		runId: string,
		starter: string | null,
	): Promise<Omit<PlanDevices, "profileFor">> {
		const spaceId = project.spaceId;
		const owner = await ownerHere(spaceId);
		// A run without a starter uses this computer's owner's Devices.
		const personId = starter ?? owner;
		const mayUse = async () =>
			personId !== null &&
			((await deps.mayUseOffers?.(spaceId, personId)) ?? false);
		const walker: PlacedDevice = {
			device,
			id: device.id,
			name: device.name,
			thisDevice: true,
			hasClone: project.repoPath !== null,
			// Another Person's run here uses this computer through its Offers.
			...(starter !== null && starter !== owner
				? {
						offered: {
							deviceName: device.name,
							offers: (await deps.offersHere?.(spaceId)) ?? [],
							mayUse: await mayUse(),
						},
					}
				: {}),
		};
		let listed: Promise<OwnDevice[]> | null = null;
		const list = () => {
			if (personId === null) return Promise.resolve([] as OwnDevice[]);
			listed ??= devicesFor(spaceId, personId, project.id);
			return listed;
		};

		/** One of the starter's other Devices, or another Person's through its Offers, checked. */
		async function other(id: string): Promise<PlacedDevice> {
			const hostedHere = (await hostSpaces.hostOf(spaceId)) === null;
			const found = (await list()).find((d) => d.deviceId === id);
			let offered: OfferedPlacement | undefined;
			if (hostedHere) {
				const paired = await registry.get(id);
				if (!paired || paired.revokedAt !== null || !deps.work) {
					throw new Refusal("invalid", UNREACHABLE_DEVICE);
				}
				if (personId === null) {
					throw new Refusal(
						"forbidden",
						`${paired.name} is not your device. A run can use your own devices only.`,
					);
				}
				if (paired.ownerId !== personId) {
					offered = await offersOf(id, paired.name);
				}
			} else if (!found) {
				throw new Refusal(
					"forbidden",
					"That device is not one of your devices on the Host of this Space.",
				);
			} else if (found.offers) {
				offered = await offersOf(id, found.name);
			}
			const name =
				found?.name ?? (await registry.get(id))?.name ?? "That device";
			if (!found?.online) {
				throw new Refusal(
					"unavailable",
					`${name} is offline. Start the run when it is online, or choose another device.`,
				);
			}
			return {
				...(offered ? { offered } : {}),
				device: remoteDevice(
					work,
					{ id, name },
					{
						spaceId,
						projectId: project.id,
						personId: personId ?? "",
						runId,
					},
				),
				id,
				name,
				thisDevice: false,
				hasClone: found.hasClone,
			};
		}

		/** Another Person's Device: its Offers into the Space; none refuses at once. */
		async function offersOf(
			id: string,
			name: string,
		): Promise<OfferedPlacement> {
			const offers = spaceOffers(await documents.open(spaceId), id);
			// The Device refuses even its folder to another Person without an Offer.
			if (offers.length === 0) {
				throw new Refusal("conflict", offersNothing(name));
			}
			return { deviceName: name, offers, mayUse: await mayUse() };
		}

		return {
			walker,
			async byId(id) {
				return (await isHere(id)) ? walker : other(id);
			},
			async byName(name) {
				const match = deviceNamed(await list(), name);
				if (!match) return name === device.name ? walker : null;
				return match.thisDevice ? walker : other(match.deviceId);
			},
		};
	}

	/**
	 * Plans a run at its start (`PlacementPort.plan`): its Person, its
	 * Devices and its nodes', each checked, and the flows it runs. The
	 * nodes on another Person's Device stay within its Offers.
	 */
	async function plan(input: PlanInput): Promise<PlannedRun> {
		const { start, project, runId } = input;
		// Every run has a starter: the Person who starts it, else this
		// computer's owner (a schedule that names no Person fires here for
		// them), as the Host of the Space knows them. A schedule names its
		// Person that way already.
		const personId =
			input.scheduled && start.startedBy
				? start.startedBy
				: await personInSpace(
						db,
						project.spaceId,
						start.startedBy ?? (await selfOwnerId(db)),
					);
		const planned = await planNodes(
			start,
			{
				...(await devicesOf(project, runId, personId)),
				profileFor: deps.profileFor ?? (() => null),
			},
			personId,
		);
		for (const { at, nodes } of planned.groups) {
			if (!at.offered) continue;
			const refusal = offerRefusal(nodes, at.offered);
			if (refusal !== null) throw new Refusal("conflict", refusal);
		}
		return planned;
	}

	/**
	 * The Device a run's walk moves to: one of the Person's own Devices
	 * (as the Host of the run's Space knows them), not this computer, and
	 * online. Null when it is not one of theirs. A move keeps the plan:
	 * each node's Device and the Person stay, only the Walker changes.
	 */
	async function moveTo(
		row: RunRow,
		actor: Actor,
		to: string,
	): Promise<{ id: string; name: string } | null> {
		const personId = await personInSpace(db, row.spaceId, actor.personId);
		const target = (
			await ownDevices(row.spaceId, personId, row.projectId)
		).find((d) => d.deviceId === to);
		if (!target || target.thisDevice) return null;
		if (!target.online) {
			throw new Refusal(
				"unavailable",
				`${target.name} is offline. Move the run when it is online.`,
			);
		}
		return { id: target.deviceId, name: target.name };
	}

	/**
	 * The flow files of a project without a Clone here: from the Clone of
	 * another of the Person's Devices.
	 */
	async function flowsElsewhere(
		spaceId: string,
		projectId: string,
		actor: string | undefined,
	): Promise<FlowSources> {
		// In a Host's Space, the Person as the Host knows them.
		const personId = actor
			? await personInSpace(db, spaceId, actor)
			: undefined;
		const at = personId
			? (await placements(spaceId, personId, projectId)).find(
					(p) => !p.thisDevice,
				)
			: undefined;
		if (!personId || !deps.work || !at) {
			throw new Refusal("conflict", NOT_ON_THIS_COMPUTER);
		}
		return remoteDevice(
			work,
			{ id: at.deviceId, name: at.name },
			{ spaceId, projectId, personId, runId: null },
		).flows(projectId);
	}

	return {
		plan,
		deviceFor,
		deviceById: (id: string, row: RunRow) => deviceById(id, row),
		moveTo,
		devicesFor,
		namesFor,
		placements,
		flowsElsewhere,
	};
}
