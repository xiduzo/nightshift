import {
	personalSpaceIdBySlug,
	personNames,
	roleAllows,
	spacesOf,
} from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type { DeviceDocument, Engine, ProfileStore } from "@nightshift/engine";
import { isAgentProfile } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { createHostSpaces, personInSpace } from "../links";
import { type DeviceRegistry, homePersonsOf } from "../registry";
import type { EngineOffers } from "./engine-offers";
import {
	deviceOffers,
	offeredProfile,
	removeDeviceOffer,
	setDeviceOffer,
} from "./offers";
import type { OfferSpace, Offers, SpaceDeviceView } from "./types";

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
 *
 * On a Host, its owner (the Host admin) also offers to the personal Space
 * of each Person whose home Host it is: there the Host is not one of that
 * Person's own Devices (ADR 1). A personal Space kept elsewhere is not
 * theirs to offer to.
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
	const hostSpaces = createHostSpaces(db);

	/**
	 * The personal Spaces this computer keeps of the Persons whose home Host
	 * it is, as "Personal of <name>", by name.
	 */
	async function theirPersonals(): Promise<OfferSpace[]> {
		const persons = (await homePersonsOf(db)).filter(
			(person) => person !== deps.ownerId,
		);
		const names = await personNames(db, persons);
		const spaces: OfferSpace[] = [];
		for (const person of persons) {
			const id = await personalSpaceIdBySlug(db, person);
			if (id === null || (await hostSpaces.hostOf(id)) !== null) continue;
			spaces.push({
				id,
				name: `Personal of ${names.get(person) ?? "a person"}`,
				personal: true,
			});
		}
		return spaces.sort((a, b) => a.name.localeCompare(b.name));
	}

	/** A Space this computer's owner is in, or a Personal they offer to; null for any other. */
	async function spaceRow(spaceId: string) {
		return (
			(await spacesOf(db, deps.ownerId)).find((s) => s.id === spaceId) ??
			(await theirPersonals()).find((s) => s.id === spaceId) ??
			null
		);
	}

	return {
		async list() {
			const views = [];
			// An Offer of a removed profile stays listed, so its owner can withdraw it.
			const nameOf = (profile: string) =>
				offeredProfile(deps.profiles, profile)?.name ?? profile;
			for (const offer of deviceOffers(document, nameOf)) {
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

		async spaces() {
			const shared = (await spacesOf(db, deps.ownerId))
				.filter((s) => !s.personal && roleAllows(s.role, { offer: ["make"] }))
				.map((s) => ({ id: s.id, name: s.name, personal: false }));
			return [...shared, ...(await theirPersonals())];
		},

		async make(input, by) {
			const profile = deps.profiles.get(input.profile);
			if (!profile) {
				throw new Refusal(
					"conflict",
					"This profile was removed. Add it under Agents first.",
				);
			}
			if (!isAgentProfile(profile)) {
				throw new Refusal(
					"invalid",
					`The profile "${profile.name}" is for Decision and Value nodes. Only an agent profile can be offered.`,
				);
			}
			const own = (await spacesOf(db, deps.ownerId)).find(
				(s) => s.id === input.spaceId,
			);
			if (own?.personal) {
				throw new Refusal(
					"invalid",
					"Nobody else is in your personal Space. Offer the profile to a shared Space.",
				);
			}
			if (own && !roleAllows(own.role, { offer: ["make"] })) {
				throw new Refusal(
					"forbidden",
					"Your role in that Space does not allow offering profiles.",
				);
			}
			if (
				!own &&
				!(await theirPersonals()).some((s) => s.id === input.spaceId)
			) {
				throw new Refusal("not-found", "That Space does not exist.");
			}
			await engine.offers.publish({
				...input,
				profileName: profile.name,
				deviceId: self.id,
				deviceName: self.name,
				by: await personInSpace(db, input.spaceId, by),
			});
			await setDeviceOffer(document, { ...input, offeredAt: Date.now() });
		},

		async renamed(profileId, by) {
			const profile = deps.profiles.get(profileId);
			if (!profile) return;
			for (const offer of deviceOffers(document, () => profile.name)) {
				if (offer.profile !== profileId) continue;
				const listed = (await engine.offers.list(offer.spaceId)).find(
					(o) => o.deviceId === self.id && o.profile === profileId,
				);
				// A Space that stopped listing it keeps it withdrawn.
				if (!listed || listed.profileName === profile.name) continue;
				try {
					await engine.offers.publish({
						spaceId: offer.spaceId,
						profile: profileId,
						profileName: profile.name,
						permissionCap: offer.permissionCap,
						sessionCap: offer.sessionCap,
						deviceId: self.id,
						deviceName: self.name,
						by: await personInSpace(db, offer.spaceId, by),
					});
				} catch (error) {
					// The rename stands. The Space shows the old name until the
					// next change of this Offer.
					console.error(
						`[offers] the new name of ${profileId} did not reach ${offer.spaceId}:`,
						error,
					);
				}
			}
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
					// The Host admin offers to a Personal they are no Member of.
					device.owner =
						(await engine.members.name(spaceId, owner)) ??
						(await personNames(db, [owner])).get(owner) ??
						null;
				}
			}
			return [...devices.values()];
		},
	};
}
