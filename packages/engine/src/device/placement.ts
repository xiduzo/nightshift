import type { Database } from "@nightshift/db";
import { device as deviceTable } from "@nightshift/db/schema/nightshift";
import type { FlowNode } from "@nightshift/flows";
import type { FlowSources } from "@nightshift/flows/files";
import { eq } from "drizzle-orm";

import type { HostSpaces } from "../exchange/host-spaces";
import { personOnHost } from "../exchange/host-spaces";
import type { RunRow } from "../graph/context";
import {
	type DeviceOffer,
	type OfferedPlacement,
	offersNothing,
	spaceOffers,
} from "../offers";
import { type ListedProject, NOT_ON_THIS_COMPUTER } from "../projects";
import type { RunLog } from "../run-log";
import type { PlacedDevice } from "../run-start";
import { projectClones, type SpaceDocuments } from "../space/document";
import type { OwnDevice, Placement, Relay } from "../types";
import type { DeviceRegistry } from "./registry";
import { remoteDevice, type WorkRelay } from "./remote";
import type { Device } from "./types";

/**
 * Placement: which Device a step runs on, and which of a Person's Devices
 * a run may use. One module owns both halves:
 *
 * - At run start (`place`): the run's Device (`deviceId`, else this
 *   computer), the Devices its nodes name (`deviceNamed`), and this
 *   computer, each checked: one of the starter's own Devices, or another
 *   Person's through its Offers into the Space (`offered`: run start then
 *   checks the nodes placed there against them), online, with a Clone
 *   where it needs one. On the Replica that keeps the Space the registry answers; on a
 *   Device in a Host's Space the Host does (`Relay.devices`).
 * - While the run walks (`deviceFor`): a node's `device`, resolved by name
 *   at start (`run.placements`), else the run's Device, else the Walker.
 *   Another Device is a `remoteDevice` over the work relay.
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
	/** How calls reach other Devices. Without it, every step runs here. */
	work?: WorkRelay;
	/** The Hosts this computer links to. */
	relay?: Relay;
	/**
	 * This computer for a step of a run: itself, or for another Person's
	 * run, itself through its Offers (`offeredDevice`). Default: itself.
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

/** The Devices a run's nodes name, by name, from its row. */
export function placementsOf(
	row: Pick<RunRow, "placements">,
): Record<string, string> {
	if (!row.placements) return {};
	try {
		const parsed: unknown = JSON.parse(row.placements);
		return parsed && typeof parsed === "object"
			? (parsed as Record<string, string>)
			: {};
	} catch {
		return {};
	}
}

/** The Device a node names, if its kind runs on one. */
function nodeDevice(node: FlowNode): string | undefined {
	return "device" in node ? node.device : undefined;
}

export function createPlacement(deps: PlacementDeps) {
	const { db, device, registry, documents, hostSpaces } = deps;
	const work = deps.work ?? UNREACHABLE;

	/** Other Devices' names, for the steps placed on them (messages only). */
	const names = new Map<string, string>();

	/** Whether an id is this computer. */
	async function isHere(id: string): Promise<boolean> {
		return id === device.id || id === (await deps.log.walkerId());
	}

	/** The Device id a node's steps run on: its `device`, else the run's, else the Walker. */
	function deviceIdFor(node: FlowNode, row: RunRow): string {
		const name = nodeDevice(node);
		const named = name !== undefined ? placementsOf(row)[name] : undefined;
		return named ?? row.deviceId ?? row.walkerId;
	}

	/** The Device a step of `node` runs on. Per-node placement lives here. */
	function deviceFor(node: FlowNode, row: RunRow): Device {
		return deviceById(deviceIdFor(node, row), row, nodeDevice(node));
	}

	/** A Device by id, for a step of the run: this computer, or a remote one. */
	function deviceById(id: string, row: RunRow, named?: string): Device {
		if (id === device.id || id === row.walkerId) {
			return deps.localFor?.(row) ?? device;
		}
		return remoteDevice(
			work,
			{
				id,
				name: names.get(id) ?? named ?? "The device of this step",
			},
			{
				spaceId: row.spaceId,
				projectId: row.projectId,
				personId: row.startedBy ?? "",
				runId: row.id,
			},
		);
	}

	/** The Person who owns this computer, as the Space's Host knows them. */
	async function ownerHere(spaceId: string): Promise<string | null> {
		const onHost = await personOnHost(db, spaceId);
		if (onHost) return onHost;
		const [self] = await db
			.select({ ownerId: deviceTable.ownerId })
			.from(deviceTable)
			.where(eq(deviceTable.self, true));
		return self?.ownerId ?? null;
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
			const listed = deps.relay
				? await deps.relay
						.devices({ spaceId, projectId })
						.catch(() => [] as OwnDevice[])
				: [];
			for (const d of listed) names.set(d.deviceId, d.name);
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
			names.set(d.id, d.name);
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
			names.set(id, paired?.name ?? name);
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
	 */
	async function devicesFor(
		spaceId: string,
		personId: string,
		projectId: string,
	): Promise<OwnDevice[]> {
		const own = await ownDevices(spaceId, personId, projectId);
		const [here, ...rest] = own as [OwnDevice, ...OwnDevice[]];
		// In a Host's Space, this computer's Person is the one who asks here.
		const owner = await ownerHere(spaceId);
		const asking = (await personOnHost(db, spaceId)) ?? personId;
		const thisOne: OwnDevice =
			owner === asking
				? here
				: {
						...here,
						offers: ((await deps.offersHere?.(spaceId)) ?? []).map(
							(o) => o.profile,
						),
					};
		return [
			thisOne,
			...rest,
			...(await offeredDevices(spaceId, personId, projectId, own)),
		];
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
	 * Places a run: its Device, the Devices its nodes name, and this
	 * computer. Each other Device is checked here first: the starter's own,
	 * online. The run's Device needs a Clone; a named one needs one only for
	 * nodes that work in the worktree (run start checks that).
	 */
	async function place(input: {
		deviceId: string | undefined;
		project: ListedProject;
		runId: string;
		personId: string | null;
	}): Promise<{
		run: PlacedDevice;
		walker: PlacedDevice;
		deviceNamed(name: string): Promise<PlacedDevice>;
	}> {
		const { project } = input;
		const spaceId = project.spaceId;
		// A schedule's run uses this computer's owner's Devices.
		const personId = input.personId ?? (await ownerHere(spaceId));
		const mayUse = async () =>
			personId !== null &&
			((await deps.mayUseOffers?.(spaceId, personId)) ?? false);
		const owner = await ownerHere(spaceId);
		const walker: PlacedDevice = {
			device,
			id: device.id,
			name: device.name,
			thisDevice: true,
			hasClone: project.repoPath !== null,
			// Another Person's run here uses this computer through its Offers.
			...(input.personId !== null && input.personId !== owner
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
					throw new Error(
						"That device cannot take runs from this computer. Pair it with this computer, or choose another device.",
					);
				}
				if (personId === null) {
					throw new Error(
						`${paired.name} is not your device. A run can use your own devices only.`,
					);
				}
				if (paired.ownerId !== personId) {
					offered = await offersOf(id, paired.name);
				}
			} else if (!found) {
				throw new Error(
					"That device is not one of your devices on the Host of this Space.",
				);
			} else if (found.offers) {
				offered = await offersOf(id, found.name);
			}
			const name =
				found?.name ?? (await registry.get(id))?.name ?? "That device";
			if (!found?.online) {
				throw new Error(
					`${name} is offline. Start the run when it is online, or choose another device.`,
				);
			}
			names.set(id, name);
			return {
				...(offered ? { offered } : {}),
				device: remoteDevice(
					work,
					{ id, name },
					{
						spaceId,
						projectId: project.id,
						personId: personId ?? "",
						runId: input.runId,
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
			if (offers.length === 0) throw new Error(offersNothing(name));
			return { deviceName: name, offers, mayUse: await mayUse() };
		}

		let run = walker;
		if (input.deviceId !== undefined && !(await isHere(input.deviceId))) {
			run = await other(input.deviceId);
			if (!run.hasClone) {
				throw new Error(
					`${run.name} does not have this project. Add its folder there first.`,
				);
			}
		}

		return {
			run,
			walker,
			async deviceNamed(name) {
				const all = (await list()).filter((d) => d.name === name);
				// A name of your own Device wins over another Person's.
				const own = all.filter((d) => !d.offers || d.thisDevice);
				const matches = own.length > 0 ? own : all;
				if (matches.length === 0 && name === device.name) return walker;
				if (matches.length === 1 && matches[0]?.thisDevice) return walker;
				if (matches.length === 0) {
					throw new Error(
						`The flow names the device "${name}", but you have no device of that name, and none of that name offers profiles to this Space. Check the node's device.`,
					);
				}
				if (matches.length > 1) {
					throw new Error(
						`Two of your devices are named "${name}". Rename one on the Devices page.`,
					);
				}
				const [match] = matches as [OwnDevice];
				return match.thisDevice ? walker : other(match.deviceId);
			},
		};
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
			? ((await personOnHost(db, spaceId)) ?? actor)
			: undefined;
		const at = personId
			? (await placements(spaceId, personId, projectId)).find(
					(p) => !p.thisDevice,
				)
			: undefined;
		if (!personId || !deps.work || !at) {
			throw new Error(NOT_ON_THIS_COMPUTER);
		}
		return remoteDevice(
			work,
			{ id: at.deviceId, name: at.name },
			{ spaceId, projectId, personId, runId: null },
		).flows(projectId);
	}

	/** Remembers the names of the Devices runs are placed on. */
	async function loadNames(): Promise<void> {
		for (const row of await db
			.select({ id: deviceTable.id, name: deviceTable.name })
			.from(deviceTable)) {
			names.set(row.id, row.name);
		}
	}

	return {
		deviceFor,
		deviceById: (id: string, row: RunRow) => deviceById(id, row),
		deviceIdFor,
		ownDevices,
		devicesFor,
		placements,
		place,
		flowsElsewhere,
		loadNames,
		/** A Device's name as this Replica knows it. */
		nameOf: (id: string) => names.get(id) ?? null,
	};
}
