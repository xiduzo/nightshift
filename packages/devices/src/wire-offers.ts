import { roleAllows } from "@nightshift/auth";
import { memberRole } from "@nightshift/engine";
import {
	wireOffers as bindOffers,
	deviceOffers,
	offeredProfile,
} from "./devices";
import type { DevicesDeps } from "./devices-runtime";
import type { PeerEngine } from "./wire-peers-engine";

/**
 * The Offers block of the devices runtime (`startDevices`): what the
 * engine reads of this computer's Offers, and the Offers its owner makes.
 */

/**
 * This computer's own Offers (its Device document), and who may use
 * Offers in a Space: the engine's options of the Offers.
 */
export function engineOffersOf(
	deps: Pick<DevicesDeps, "document" | "profiles" | "spaces">,
) {
	return {
		ownOffers: () =>
			deviceOffers(
				deps.document,
				(profile) => offeredProfile(deps.profiles, profile)?.name ?? null,
			),
		mayUseOffers: async (spaceId: string, personId: string) => {
			const role = memberRole(await deps.spaces.open(spaceId), personId);
			return role !== null && roleAllows(role, { offer: ["use"] });
		},
	};
}

/** This computer's Offers into Spaces, as its owner makes and withdraws them. */
export function wireOffers(
	deps: Pick<DevicesDeps, "db" | "document" | "profiles" | "self" | "ownerId">,
	engine: PeerEngine,
) {
	const { self } = deps;
	return bindOffers().createOffers({
		db: deps.db,
		engine,
		document: deps.document,
		profiles: deps.profiles,
		self: { id: self.id, name: self.name },
		ownerId: deps.ownerId,
		withdrawn: (spaceId, profile) =>
			engine.admission.withdrawn(spaceId, profile),
	});
}
