import type { OfferCaps } from "../../../contract";
import type { Memberships, Registry, SpaceOffers, SpaceReads } from "./ports";

/**
 * A Device of a Space, as any Member sees it: its name, its owner,
 * whether it is online, which of the Space's Projects it has a Clone of,
 * and the profiles it offers. Nothing else of the Device.
 */
export type SpaceDeviceView = {
	id: string;
	name: string;
	/** Null when this computer cannot tell (it is not the Space's Host). */
	online: boolean | null;
	thisDevice: boolean;
	/** One of the Person's own Devices: this computer, or one of theirs the Space knows. */
	mine: boolean;
	/** Its owner's name in the Space. Null when this computer cannot tell. */
	owner: string | null;
	/** `process.platform`. Null when this computer cannot tell. */
	platform: string | null;
	/** Epoch ms of its last connection. Null when this computer cannot tell. */
	lastSeenAt: number | null;
	clones: { projectId: string; projectName: string }[];
	/** `profile`: the profile's id. */
	offers: (OfferCaps & { profile: string; profileName: string })[];
};

export type ListSpaceDevicesPorts = {
	spaceOffers: Pick<SpaceOffers, "list">;
	spaceReads: Pick<SpaceReads, "listProjects" | "memberName">;
	memberships: Pick<Memberships, "personInSpace" | "personNames">;
	registry: Pick<Registry, "get">;
	self: { id: string };
	ownerId: string;
};

/** The Devices of a Space as its Members see them. `mine` marks the Person's. */
export const listSpaceDevices =
	(ports: ListSpaceDevicesPorts) =>
	async (spaceId: string, personId: string): Promise<SpaceDeviceView[]> => {
		const projects = await ports.spaceReads.listProjects(spaceId);
		const offers = await ports.spaceOffers.list(spaceId);
		// This computer's owner, as the Space knows them: on the Host of a
		// Space it keeps, they have the id of their link there.
		const owner = await ports.memberships.personInSpace(spaceId, ports.ownerId);
		// The session's Person, as the Space knows them.
		const me = personId === ports.ownerId ? owner : personId;
		const devices = new Map<string, SpaceDeviceView>();
		/** Each Device's owner, as the Space knows them. */
		const owners = new Map<string, string>();
		const entry = (id: string, name: string | null, thisDevice: boolean) => {
			let found = devices.get(id);
			if (!found) {
				found = {
					id,
					name: name ?? "A device",
					online: thisDevice ? true : null,
					thisDevice,
					mine: false,
					owner: null,
					platform: null,
					lastSeenAt: null,
					clones: [],
					offers: [],
				};
				devices.set(id, found);
				if (thisDevice && owner) owners.set(id, owner);
			}
			return found;
		};
		for (const project of projects) {
			for (const clone of project.clones) {
				entry(clone.deviceId, clone.deviceName, clone.thisDevice).clones.push({
					projectId: project.id,
					projectName: project.name,
				});
			}
		}
		for (const offer of offers) {
			entry(
				offer.deviceId,
				offer.deviceName,
				offer.deviceId === ports.self.id,
			).offers.push({
				profile: offer.profile,
				profileName: offer.profileName,
				permissionCap: offer.permissionCap,
				sessionCap: offer.sessionCap,
			});
			// Only a Device's owner offers its profiles.
			if (offer.by && !owners.has(offer.deviceId)) {
				owners.set(offer.deviceId, offer.by);
			}
		}
		for (const device of devices.values()) {
			if (!device.thisDevice) {
				// A Host knows its paired Devices: their owner, whether they are online.
				const paired = await ports.registry.get(device.id);
				if (paired) {
					device.online = paired.revokedAt === null && paired.online;
					device.platform = paired.platform;
					device.lastSeenAt = paired.lastSeenAt;
					owners.set(device.id, paired.ownerId);
				}
			}
			const ownerId = owners.get(device.id);
			if (ownerId) {
				device.mine = ownerId === me;
				// The Host admin offers to a Personal they are no Member of.
				device.owner =
					(await ports.spaceReads.memberName(spaceId, ownerId)) ??
					(await ports.memberships.personNames([ownerId])).get(ownerId) ??
					null;
			}
		}
		return [...devices.values()];
	};
