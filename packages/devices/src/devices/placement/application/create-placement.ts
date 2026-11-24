import type * as Engine from "@nightshift/engine";
import type {
	Device,
	DeviceProfile,
	OfferedPlacement,
	OwnDevice,
	PeerProfiles,
	PeerProjects,
	PersonActor,
	PlacedDevice,
	PlacedRun,
	Placement,
	PlanDevices,
	PlanInput,
	PlannedRun,
	SpaceDocuments,
} from "@nightshift/engine";
import type { ListedProject } from "@nightshift/engine/projects";
import type { DeviceCopy } from "@nightshift/engine/settings";
import type { FlowSources } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { HostRelay, WorkRelay } from "../../../contract";
import type { HostSpaces } from "../../../links";
import type * as Work from "../../../work";
import type { DeviceOffer } from "../../offers";
import {
	hostOffersNothing,
	offerRefusal,
	offersNothing,
	spaceOffers,
} from "../../offers";
import type { DeviceRegistry } from "../../registry";
import { hasProject, offeredChoice } from "../domain/listed-device";
import { NO_STARTER_RELAY, UNREACHABLE } from "../domain/no-relay";
import type { DeviceCopiesPort, SpacePeople } from "./ports";
export type PlacementDeps = {
	device: Device;
	walkerId(): Promise<string>;
	registry: DeviceRegistry;
	documents: SpaceDocuments;
	hostSpaces: HostSpaces;
	spacePeople: SpacePeople;
	projects: Pick<PeerProjects, "find" | "clones">;
	profiles: Pick<PeerProfiles, "here" | "lastKnown">;
	keptDevice(deviceId: string): Promise<DeviceCopy | null>;
	flows(projectId: string): Promise<FlowSources>;
	work?: WorkRelay;
	relay?: HostRelay;
	localFor?(run: PlacedRun): Device;
	isHost?(): boolean;
	offersHere?(spaceId: string): Promise<DeviceOffer[]>;
	ownProfiles?(): readonly DeviceProfile[];
	copies?: DeviceCopiesPort;
	mayUseOffers?(spaceId: string, personId: string): Promise<boolean>;
	engineFns: PlacementEngineFns;
};

export type PlacementEngineFns = {
	planNodes: typeof Engine.planNodes;
	deviceNameIn: typeof Engine.deviceNameIn;
	HostUnreachableError: typeof Engine.HostUnreachableError;
	UNREACHABLE_DEVICE: typeof Engine.UNREACHABLE_DEVICE;
	remoteDevice: typeof Work.remoteDevice;
};

export type PlacementModule = ReturnType<typeof createPlacement>;

export function createPlacement(deps: PlacementDeps) {
	const { device, registry, documents, hostSpaces, spacePeople, engineFns } =
		deps;
	const {
		planNodes,
		deviceNameIn,
		HostUnreachableError,
		UNREACHABLE_DEVICE,
		remoteDevice,
	} = engineFns;
	const work = deps.work ?? UNREACHABLE;

	async function isHere(id: string): Promise<boolean> {
		return id === device.id || id === (await deps.walkerId());
	}

	/** A Device of a run by id, as the run reaches it (`PlacementPort.deviceById`): this computer (through its Offer admission for another Person's run), or another Device of its plan over the work relay, named as the plan names it, else as `name` says. */
	function deviceById(id: string, run: PlacedRun, name?: string): Device {
		if (id === device.id || id === run.walkerId) {
			return deps.localFor?.(run) ?? device;
		}
		const { plan } = run;
		return remoteDevice(
			plan.personId === null ? NO_STARTER_RELAY : work,
			{ id, name: name ?? plan.devices[id]?.name ?? "The device of this step" },
			{
				spaceId: run.spaceId,
				projectId: run.projectId,
				personId: plan.personId ?? "",
				runId: run.id,
			},
		);
	}

	/** The copies of the owner's other Devices' documents that count for a Person in a Space: only in a Space of the home Host, and only for this computer's own Person there. */
	async function copiesFor(spaceId: string, personId: string) {
		if (!deps.copies || !(await spacePeople.keptByHomeHost(spaceId))) return [];
		if ((await ownerHere(spaceId)) !== personId) return [];
		return deps.copies.list();
	}

	/** The Person who owns this computer, as the Space's Host knows them. */
	async function ownerHere(spaceId: string): Promise<string | null> {
		return spacePeople.personInSpace(spaceId, await registry.selfOwnerId());
	}

	/** A Person's Devices for a project of a Space: this computer first, then their other Devices, each with whether it is online and has a Clone. */
	async function ownDevices(
		spaceId: string,
		personId: string,
		projectId: string,
	): Promise<OwnDevice[]> {
		const project = await deps.projects.find(projectId, spaceId);
		const self = await deps.walkerId();
		const here: OwnDevice = {
			deviceId: self,
			name: device.name,
			thisDevice: true,
			online: true,
			hasClone: hasProject(project, project.repoPath !== null),
			...(deps.ownProfiles ? { profiles: [...deps.ownProfiles()] } : {}),
		};
		if ((await hostSpaces.hostOf(spaceId)) !== null) {
			const copies = await copiesFor(spaceId, personId);
			const listed = deps.relay
				? await deps.relay
						.devices({ spaceId, projectId })
						.catch((error: unknown) => {
							// A refusal of the Host stands. A link that dropped, a fetch
							// that failed: the Host cannot be reached now.
							if (
								error instanceof Refusal &&
								!(error instanceof HostUnreachableError)
							) {
								throw error;
							}
							return null;
						})
				: [];
			if (listed === null) {
				// The Host cannot be reached: this computer, and the owner's
				// other Devices as their copies last told, offline.
				const document = await documents.open(spaceId);
				const withClone = new Set(
					(await deps.projects.clones(spaceId, projectId)).map(
						(c) => c.deviceId,
					),
				);
				return [
					here,
					...copies.map((copy) => ({
						deviceId: copy.deviceId,
						name:
							copy.name ?? deviceNameIn(document, copy.deviceId) ?? "Device",
						thisDevice: false,
						online: false,
						hasClone: hasProject(project, withClone.has(copy.deviceId)),
						profiles: copy.profiles,
					})),
				];
			}
			const copyOf = new Map(copies.map((c) => [c.deviceId, c]));
			return [
				here,
				...listed
					.filter((d) => d.deviceId !== self)
					.map((d) => {
						// A Host that cannot tell a Device's profiles: its copy here can.
						const profiles =
							d.profiles ??
							(d.offers === undefined
								? copyOf.get(d.deviceId)?.profiles
								: undefined);
						return {
							...d,
							thisDevice: false,
							...(profiles ? { profiles } : {}),
						};
					}),
			];
		}
		const withClone = new Set(
			(await deps.projects.clones(spaceId, projectId)).map((c) => c.deviceId),
		);
		const own: OwnDevice[] = [];
		for (const d of await registry.list(personId)) {
			if (d.revokedAt !== null || d.id === self) continue;
			// Known only when this Replica keeps a copy of its Device document.
			const profiles = (await deps.keptDevice(d.id))?.profiles;
			own.push({
				deviceId: d.id,
				name: d.name,
				thisDevice: false,
				online: await work.online(d.id, spaceId),
				hasClone: hasProject(project, withClone.has(d.id)),
				...(d.dev ? { dev: true } : {}),
				...(profiles ? { profiles } : {}),
			});
		}
		return [here, ...own];
	}

	/** Other Persons' Devices that offer profiles to the Space, from its document (the keeping Replica's, or the copy a Host syncs here): each with its offered profiles, whether it takes work and has a Clone. */
	async function offeredDevices(
		spaceId: string,
		personId: string,
		projectId: string,
		own: readonly OwnDevice[],
	): Promise<OwnDevice[]> {
		const project = await deps.projects.find(projectId, spaceId);
		const document = await documents.open(spaceId);
		const withClone = new Set(
			(await deps.projects.clones(spaceId, projectId)).map((c) => c.deviceId),
		);
		const mine = new Set(own.map((d) => d.deviceId));
		const self = await deps.walkerId();
		const byDevice = new Map<
			string,
			{ name: string; offers: string[]; profiles: DeviceProfile[] }
		>();
		for (const offer of spaceOffers(document)) {
			if (offer.deviceId === self || offer.deviceId === device.id) continue;
			if (mine.has(offer.deviceId)) continue;
			const entry = byDevice.get(offer.deviceId) ?? {
				name: offer.deviceName,
				offers: [],
				profiles: [],
			};
			// A flow names a profile by its name.
			entry.offers.push(offer.profileName);
			entry.profiles.push(offeredChoice(offer));
			byDevice.set(offer.deviceId, entry);
		}
		const others: OwnDevice[] = [];
		for (const [id, { name, offers, profiles }] of byDevice) {
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
				profiles,
				online: await work.online(id, spaceId),
				hasClone: hasProject(project, withClone.has(id)),
			});
		}
		return others;
	}

	/** The Devices a Person may place a run's steps on: their own (this computer first), then other Persons' that offer profiles to the Space. */
	async function devicesFor(
		spaceId: string,
		personId: string,
		projectId: string,
		ownOnly?: boolean,
	): Promise<OwnDevice[]> {
		const own = await ownDevices(spaceId, personId, projectId);
		const [here, ...rest] = own as [OwnDevice, ...OwnDevice[]];
		// In a Host's Space, this computer's Person is the one who asks here.
		const owner = await ownerHere(spaceId);
		const asking = await spacePeople.personInSpace(spaceId, personId);
		const offeredHere =
			owner === asking ? [] : ((await deps.offersHere?.(spaceId)) ?? []);
		const ownerName = owner === asking ? undefined : await nameOfOwner(owner);
		const thisOne: OwnDevice =
			owner === asking
				? here
				: {
						...here,
						offers: offeredHere.map((o) => o.profileName),
						profiles: offeredHere.map(offeredChoice),
						...(ownerName ? { ownerName } : {}),
					};
		const all = [
			thisOne,
			...rest,
			...(await offeredDevices(spaceId, personId, projectId, own)),
		];
		return ownOnly ? all.filter((d) => d.offers === undefined) : all;
	}

	/** The Devices a run of the project can run on: online, with a Clone. */
	async function placements(
		spaceId: string,
		personId: string,
		projectId: string,
	): Promise<Placement[]> {
		return (
			(await devicesFor(spaceId, personId, projectId))
				// A development install shows only on itself (ADR 17).
				.filter((d) => d.online && d.hasClone && (!d.dev || d.thisDevice))
				.map(({ deviceId, name, thisDevice, offers, ownerName }) => ({
					deviceId,
					name,
					thisDevice,
					...(offers ? { offers } : {}),
					...(ownerName ? { ownerName } : {}),
				}))
		);
	}

	/** The Devices a run of the project may use, for the Person it runs for: this computer (through its Offers, for another Person's run), and the others by id, each checked first: the Person's own, or another Person's through its Offers, online. */
	async function devicesOf(
		project: ListedProject,
		runId: string,
		starter: string | null,
	): Promise<Omit<PlanDevices, "profileFor" | "flows">> {
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
			hasClone: hasProject(project, project.repoPath !== null),
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
			if (!found) {
				throw new Refusal(
					"unavailable",
					`${name} is offline. Start the run when it is online, or choose another device.`,
				);
			}
			return {
				...(offered ? { offered } : {}),
				...(found.online ? {} : { offline: true }),
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
			async nodeDevice(id) {
				if (await isHere(id)) return walker;
				const match = (await list()).find((d) => d.deviceId === id);
				if (!match) return null;
				return match.thisDevice ? walker : other(match.deviceId);
			},
		};
	}

	/** Plans a run at its start (`PlacementPort.plan`): its Person, its Devices and its nodes', each checked, and the flows it runs. */
	async function plan(input: PlanInput): Promise<PlannedRun> {
		const { start, project, runId } = input;
		// Every run has a starter: the Person who starts it, else this
		// computer's owner (a schedule that names no Person fires here for
		// them), as the Host of the Space knows them. A schedule names its
		// Person that way already.
		const personId =
			input.scheduled && start.startedBy
				? start.startedBy
				: await spacePeople.personInSpace(
						project.spaceId,
						start.startedBy ?? (await registry.selfOwnerId()),
					);
		let known: Promise<OwnDevice[]> | null = null;
		const listed = () => {
			if (personId === null) return Promise.resolve(null);
			known ??= devicesFor(project.spaceId, personId, project.id);
			return known;
		};
		const remoteHost = await hostSpaces.hostOf(project.spaceId);
		const hostId =
			remoteHost ?? (deps.isHost?.() ? await deps.walkerId() : null);
		const planned = await planNodes(
			start,
			{
				...(await devicesOf(project, runId, personId)),
				profileFor: deps.profiles.here,
				// A node's offline Device: its profiles as its document last said.
				lastKnown: deps.profiles.lastKnown,
				deviceName: async (id) =>
					deviceNameIn(await documents.open(project.spaceId), id) ??
					(await registry.get(id))?.name ??
					null,
				flows: deps.flows,
				keeperId:
					(await hostSpaces.hostOf(project.spaceId)) ?? (await deps.walkerId()),
				...(hostId ? { hostId } : {}),
				profilesOf: async (id) =>
					(await listed())?.find((d) => d.deviceId === id)?.profiles ?? null,
				lastResort: async () =>
					((await listed()) ?? [])
						.filter((d) => d.online && d.hasClone && !d.dev)
						.map((d) => d.deviceId)
						.sort(
							(a, b) =>
								Number(b === input.lastRun) - Number(a === input.lastRun),
						),
			},
			personId,
			input.byPerson,
		);
		for (const { at, nodes } of planned.groups) {
			if (!at.offered) continue;
			const refusal = offerRefusal(nodes, at.offered);
			if (refusal === null) continue;
			throw new Refusal(
				"conflict",
				(await hostRefusal(at, project.spaceId, personId)) ?? refusal,
			);
		}
		return planned;
	}

	/** In the starter's Personal on their home Host, this computer is the Host admin's: a refusal that says whose it is and what to do. */
	async function hostRefusal(
		at: PlacedDevice,
		spaceId: string,
		personId: string | null,
	): Promise<string | null> {
		if (!at.thisDevice || !at.offered || at.offered.offers.length > 0) {
			return null;
		}
		if (personId === null || !at.offered.mayUse) return null;
		if ((await hostSpaces.hostOf(spaceId)) !== null) return null;
		if ((await spacePeople.personalSpaceIdBySlug(personId)) !== spaceId)
			return null;
		const name = await nameOfOwner(await registry.selfOwnerId());
		return hostOffersNothing(device.name, name ?? "another person");
	}

	/** The name of this computer's owner, when Night Shift knows it. */
	async function nameOfOwner(
		owner: string | null,
	): Promise<string | undefined> {
		if (!owner) return undefined;
		return (await spacePeople.personNames([owner])).get(owner) || undefined;
	}

	/** The Device a run's walk moves to: one of the Person's own Devices (as the Host of the run's Space knows them), not this computer, and online. */
	async function moveTo(
		run: PlacedRun,
		actor: PersonActor,
		to: string,
	): Promise<{ id: string; name: string } | null> {
		const personId = await spacePeople.personInSpace(
			run.spaceId,
			actor.personId,
		);
		const target = (
			await ownDevices(run.spaceId, personId, run.projectId)
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

	return {
		plan,
		deviceById,
		moveTo,
		devicesFor,
		placements,
	};
}
