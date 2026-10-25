import { spacesOf } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type { DeviceDocument, Engine, ProfileStore } from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import { personInSpace } from "../links";
import type { DeviceRegistry } from "../registry";
import type { EngineOffers } from "./engine-offers";
import { deviceOffers, removeDeviceOffer, setDeviceOffer } from "./offers";
import type { Offers, SpaceDeviceView } from "./types";

/**
 * This computer's Offers, as its owner makes and withdraws them (the
 * Agents page, the Devices page). An Offer is two entries: this
 * computer's own, in its Device document (the caps it enforces), and the
 * publication in the Space document, which the Replica that keeps the
 * Space writes (`engine.offers`: here, or through the Space's Host).
 *
 * Making publishes first, then keeps its own entry. Withdrawing removes
 * its own entry first, so this computer refuses new work under it at
 * once; then the Space stops listing it and the runs walked there stop
 * their steps under it; then whatever still runs here under it is
 * aborted, also when the Host cannot be reached.
 */
export function createOffers(deps: {
	db: Database;
	/**
	 * This Device's engine (`PeerEngine`): the Offers of the Spaces, the
	 * Devices paired with it, and the Members' names its Space documents
	 * mirror.
	 */
	engine: Engine & {
		offers: EngineOffers;
		devices: Pick<DeviceRegistry, "get">;
		members: {
			name(spaceId: string, personId: string): Promise<string | null>;
		};
	};
	document: DeviceDocument;
	profiles: ProfileStore;
	self: { id: string; name: string };
	/** The Person who owns this computer, on this Replica. */
	ownerId: string;
	/** Aborts the calls running here under the Offer. */
	withdrawn(spaceId: string, profile: string): void;
}): Offers {
	const { db, engine, document, self } = deps;

	/** A Space of this computer's owner, or null for one they are not in. */
	async function spaceRow(spaceId: string) {
		return (
			(await spacesOf(db, deps.ownerId)).find((s) => s.id === spaceId) ?? null
		);
	}

	return {
		async list() {
			const views = [];
			for (const offer of deviceOffers(document)) {
				const space = await spaceRow(offer.spaceId);
				const listed = (await engine.offers.list(offer.spaceId)).some(
					(o) => o.deviceId === self.id && o.profile === offer.profile,
				);
				// This computer's Person, as the Space knows them.
				const me = await personInSpace(db, offer.spaceId, deps.ownerId);
				const runs = [];
				for (const r of (await engine.space(offer.spaceId).listRuns())
					.filter(
						(r) =>
							r.device.id === self.id &&
							r.startedBy !== null &&
							r.startedBy.id !== me,
					)
					.slice(0, 10)) {
					runs.push({
						id: r.id,
						title: r.title,
						status: r.status,
						// A colleague's account is on the Host: the Space's mirror names them.
						startedBy:
							r.startedBy?.name ??
							(r.startedBy
								? await engine.members.name(offer.spaceId, r.startedBy.id)
								: null),
						createdAt: r.createdAt,
					});
				}
				views.push({
					...offer,
					spaceName: space?.name ?? "A Space you left",
					listed,
					runs,
				});
			}
			return views;
		},

		async make(input, by) {
			if (!deps.profiles.get(input.profile)) {
				throw new Refusal(
					"conflict",
					`There is no profile named "${input.profile}". Add it under Agents first.`,
				);
			}
			const space = await spaceRow(input.spaceId);
			if (!space) throw new Refusal("not-found", "That Space does not exist.");
			if (space.personal) {
				throw new Refusal(
					"invalid",
					"Nobody else is in a personal Space. Offer the profile to a shared Space.",
				);
			}
			await engine.offers.publish({
				...input,
				deviceId: self.id,
				deviceName: self.name,
				by: await personInSpace(db, input.spaceId, by),
			});
			await setDeviceOffer(document, { ...input, offeredAt: Date.now() });
		},

		async withdraw(input, by) {
			await removeDeviceOffer(document, input.spaceId, input.profile);
			try {
				await engine.offers.withdraw({
					...input,
					deviceId: self.id,
					by: await personInSpace(db, input.spaceId, by),
				});
			} finally {
				deps.withdrawn(input.spaceId, input.profile);
			}
		},

		async spaceDevices(spaceId, personId) {
			const projects = await engine.space(spaceId).listProjects();
			const offers = await engine.offers.list(spaceId);
			// This computer's owner, as the Space knows them: on the Host of a
			// Space it keeps, they have the id of their link there.
			const owner = await personInSpace(db, spaceId, deps.ownerId);
			// The session's Person, as the Space knows them.
			const me = personId === deps.ownerId ? owner : personId;
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
					if (thisDevice) owners.set(id, owner);
				}
				return found;
			};
			for (const project of projects) {
				for (const clone of project.clones) {
					entry(clone.deviceId, clone.deviceName, clone.thisDevice).clones.push(
						{
							projectId: project.id,
							projectName: project.name,
						},
					);
				}
			}
			for (const offer of offers) {
				entry(
					offer.deviceId,
					offer.deviceName,
					offer.deviceId === self.id,
				).offers.push({
					profile: offer.profile,
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
					const paired = await engine.devices.get(device.id);
					if (paired) {
						device.online = paired.revokedAt === null && paired.online;
						device.platform = paired.platform;
						device.lastSeenAt = paired.lastSeenAt;
						owners.set(device.id, paired.ownerId);
					}
				}
				const owner = owners.get(device.id);
				if (owner) {
					device.mine = owner === me;
					device.owner = await engine.members.name(spaceId, owner);
				}
			}
			return [...devices.values()];
		},
	};
}
