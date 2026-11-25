import type { OwnDevice } from "@nightshift/engine";

import type { DeviceRegistry } from "../../registry";

import {
	offered,
	offeringDevices,
	standsOffered,
} from "../domain/offered-devices";
import { projectOn } from "../domain/takes-work";
import { listedThroughOffers, throughOffers } from "../domain/through-offers";
import { type ListOwnDevicesPorts, listOwnDevices } from "./list-own-devices";
import type { SpacePeople, ThisComputer } from "./ports";

export type ListRunDevicesPorts = ListOwnDevicesPorts & {
	here: Pick<ThisComputer, "offersHere">;
	people: Pick<SpacePeople, "personName">;
	registry: Pick<DeviceRegistry, "get">;
};

/** Lists the Devices a Person may place a run's steps on: their own (this computer first), then other Persons' that offer profiles to the Space. With `ownOnly`, none that takes the Person through its Offers. */
export function listRunDevices(ports: ListRunDevicesPorts) {
	const { here, spaces, people, registry, projects } = ports;
	const ownDevices = listOwnDevices(ports);

	/** Other Persons' Devices with Offers into the Space, from its document (the keeping Replica's, or the copy a Host syncs here). */
	async function offering(
		spaceId: string,
		personId: string,
		projectId: string,
		own: readonly OwnDevice[],
	): Promise<OwnDevice[]> {
		const project = await projects.find(projectId, spaceId);
		const document = await spaces.open(spaceId);
		const has = projectOn(project, await projects.clones(spaceId, projectId));
		const known = new Set([
			await here.walkerId(),
			here.device.id,
			...own.map((d) => d.deviceId),
		]);
		const others: OwnDevice[] = [];
		for (const device of offeringDevices(document.offers(), known)) {
			const paired = await registry.get(device.deviceId);
			if (!standsOffered(paired, personId)) continue;
			others.push({
				...device,
				name: paired?.name ?? device.name,
				thisDevice: false,
				online: await ports.others.online(device.deviceId, spaceId),
				hasClone: has(device.deviceId),
			});
		}
		return others;
	}

	/** This computer, as its Offers show it to a Person who does not own it. */
	async function hereFor(
		self: OwnDevice,
		spaceId: string,
		personId: string,
	): Promise<OwnDevice> {
		// In a Host's Space, this computer's Person is the one who asks here.
		const owner = await people.ownerIn(spaceId);
		const asking = await people.personInSpace(spaceId, personId);
		if (!throughOffers(asking, owner)) return self;
		const offers = await here.offersHere(spaceId);
		const ownerName = owner && (await people.personName(owner));
		return {
			...self,
			...offered(offers),
			...(ownerName ? { ownerName } : {}),
		};
	}

	return async (
		spaceId: string,
		personId: string,
		projectId: string,
		ownOnly = false,
	): Promise<OwnDevice[]> => {
		const own = await ownDevices(spaceId, personId, projectId);
		const [self, ...rest] = own as [OwnDevice, ...OwnDevice[]];
		const all = [
			await hereFor(self, spaceId, personId),
			...rest,
			...(await offering(spaceId, personId, projectId, own)),
		];
		return ownOnly ? all.filter((d) => !listedThroughOffers(d)) : all;
	};
}
