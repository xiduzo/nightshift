import type {
	OfferedPlacement,
	OwnDevice,
	PlacedDevice,
	PlanInput,
	PlannedRun,
} from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import { hostOffersNothing, offerRefusal, offersNothing } from "../../offers";
import type { DeviceRegistry } from "../../registry";

import { hasProject, lastResort } from "../domain/takes-work";
import { listedThroughOffers, throughOffers } from "../domain/through-offers";
import { type ListRunDevicesPorts, listRunDevices } from "./list-run-devices";
import type {
	OtherDevices,
	RunPlanner,
	SpacePeople,
	ThisComputer,
} from "./ports";

export type PlanRunPorts = ListRunDevicesPorts & {
	here: Pick<ThisComputer, "isHost">;
	registry: Pick<DeviceRegistry, "selfOwnerId">;
	people: Pick<SpacePeople, "personalSpaceIdBySlug" | "mayUseOffers">;
	others: Pick<OtherDevices, "reaches" | "at">;
	planner: RunPlanner;
};

/** Plans a run at its start: its Person, its Devices and its nodes', each checked, and the flows it runs. It asks for the list of Devices once, and only when the walk needs it. */
export function planRun(ports: PlanRunPorts) {
	const { here, spaces, people, registry, others, planner } = ports;
	const devicesFor = listRunDevices(ports);

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
		if ((await spaces.hostOf(spaceId)) !== null) return null;
		if ((await people.personalSpaceIdBySlug(personId)) !== spaceId) return null;
		const owner = await registry.selfOwnerId();
		const name = owner && (await people.personName(owner));
		return hostOffersNothing(here.device.name, name || "another person");
	}

	/**
	 * The Person a run acts for: its starter, else this computer's owner (a
	 * schedule that names no Person fires here for them), as the Host of the
	 * Space knows them. A schedule names its Person that way already.
	 */
	async function runsFor(
		{ start: { startedBy }, scheduled }: PlanInput,
		spaceId: string,
	): Promise<string | null> {
		if (scheduled && startedBy) return startedBy;
		return startedBy === undefined
			? people.ownerIn(spaceId)
			: people.personInSpace(spaceId, startedBy);
	}

	return async (input: PlanInput): Promise<PlannedRun> => {
		const { start, project, runId } = input;
		const { spaceId } = project;
		const personId = await runsFor(input, spaceId);
		const remoteHost = await spaces.hostOf(spaceId);
		const hostId = remoteHost ?? (here.isHost() ? await here.walkerId() : null);
		const owner = await people.ownerIn(spaceId);
		// A run without a starter uses this computer's owner's Devices.
		const userId = personId ?? owner;

		let listed: Promise<OwnDevice[]> | null = null;
		const list = () => {
			listed ??=
				userId === null
					? Promise.resolve([])
					: devicesFor(spaceId, userId, project.id);
			return listed;
		};
		const find = async (id: string) =>
			(await list()).find((d) => d.deviceId === id);

		const mayUse = async () =>
			userId !== null && people.mayUseOffers(spaceId, userId);

		/** Another Person's Device: its Offers into the Space; none refuses at once. */
		async function offersOf(
			id: string,
			name: string,
		): Promise<OfferedPlacement> {
			const offers = (await spaces.open(spaceId))
				.offers()
				.filter((o) => o.deviceId === id);
			// The Device refuses even its folder to another Person without an Offer.
			if (offers.length === 0) {
				throw new Refusal("conflict", offersNothing(name));
			}
			return { deviceName: name, offers, mayUse: await mayUse() };
		}

		/** Another Device in a Space kept here: paired, with access, and the Person's or offered. */
		async function pairedHere(id: string) {
			const found = await find(id);
			const paired = await registry.get(id);
			if (!paired || paired.revokedAt !== null || !others.reaches) {
				throw planner.unreachable();
			}
			if (userId === null) {
				throw new Refusal(
					"forbidden",
					`${paired.name} is not your device. A run can use your own devices only.`,
				);
			}
			const offered = throughOffers(userId, paired.ownerId)
				? await offersOf(id, paired.name)
				: undefined;
			if (!found) {
				throw new Refusal(
					"unavailable",
					`${paired.name} is offline. Start the run when it is online, or choose another device.`,
				);
			}
			return { found, offered, userId };
		}

		/** Another Device in a Space a Host keeps: one the Host lists for the Person, or an offered one. */
		async function listedByHost(id: string) {
			const found = await find(id);
			if (!found || userId === null) {
				throw new Refusal(
					"forbidden",
					"That device is not one of your devices on the Host of this Space.",
				);
			}
			const offered = listedThroughOffers(found)
				? await offersOf(id, found.name)
				: undefined;
			return { found, offered, userId };
		}

		/** One of the starter's other Devices, or another Person's through its Offers, checked. */
		async function other(id: string): Promise<PlacedDevice> {
			const at = await ((await spaces.hostOf(spaceId)) === null
				? pairedHere(id)
				: listedByHost(id));
			const { name, online, hasClone } = at.found;
			return {
				...(at.offered ? { offered: at.offered } : {}),
				...(online ? {} : { offline: true }),
				device: others.at(
					{ id, name },
					{ spaceId, projectId: project.id, personId: at.userId, runId },
				),
				id,
				name,
				thisDevice: false,
				hasClone,
			};
		}

		const walker: PlacedDevice = {
			device: here.device,
			id: here.device.id,
			name: here.device.name,
			thisDevice: true,
			hasClone: hasProject(project, project.repoPath !== null),
			// Another Person's run here uses this computer through its Offers.
			...(throughOffers(personId, owner)
				? {
						offered: {
							deviceName: here.device.name,
							offers: await here.offersHere(spaceId),
							mayUse: await mayUse(),
						},
					}
				: {}),
		};
		const isHere = async (id: string) =>
			id === here.device.id || id === (await here.walkerId());

		const planned = await planner.planNodes(
			start,
			{
				walker,
				byId: async (id) => ((await isHere(id)) ? walker : other(id)),
				nodeDevice: async (id) => {
					if (await isHere(id)) return walker;
					const match = await find(id);
					if (!match) return null;
					return match.thisDevice ? walker : other(id);
				},
				profileFor: planner.profileFor,
				lastKnown: planner.lastKnown,
				deviceName: async (id) =>
					(await spaces.open(spaceId)).deviceName(id) ??
					(await registry.get(id))?.name ??
					null,
				flows: planner.flows,
				keeperId: (await spaces.hostOf(spaceId)) ?? (await here.walkerId()),
				...(hostId ? { hostId } : {}),
				profilesOf: async (id) => (await find(id))?.profiles ?? null,
				lastResort: async () => lastResort(await list(), input.lastRun),
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
				(await hostRefusal(at, spaceId, personId)) ?? refusal,
			);
		}
		return planned;
	};
}
