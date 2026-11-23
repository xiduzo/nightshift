import type { DeviceOffers } from "../../application/ports";
import type { DeviceOffer, DeviceOfferEntry } from "../../domain/offers";

/**
 * `DeviceOffers` in memory for use-case tests. Production never imports
 * this file.
 */
export function inMemoryDeviceOffers(
	initial: DeviceOfferEntry[] = [],
): DeviceOffers & { entries: Map<string, DeviceOfferEntry> } {
	const entries = new Map(
		initial.map((offer) => [`${offer.spaceId}/${offer.profile}`, { ...offer }]),
	);
	return {
		entries,
		list(nameOf) {
			const offers: DeviceOffer[] = [];
			for (const entry of entries.values()) {
				const profileName = nameOf(entry.profile);
				if (profileName !== null) offers.push({ ...entry, profileName });
			}
			return offers.sort((a, b) => a.offeredAt - b.offeredAt);
		},
		async set(entry) {
			entries.set(`${entry.spaceId}/${entry.profile}`, { ...entry });
		},
		async remove(spaceId, profile) {
			entries.delete(`${spaceId}/${profile}`);
		},
	};
}
