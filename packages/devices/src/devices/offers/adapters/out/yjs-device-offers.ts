import type { DeviceDocument } from "@nightshift/engine";
import type { DeviceOffers } from "../../application/ports";
import {
	type DeviceOfferEntry,
	deviceOffers,
	removeDeviceOffer,
	setDeviceOffer,
} from "../../domain/offers";

/** `DeviceOffers` over the Device document's `offers` map. */
export function yjsDeviceOffers(
	document: Pick<DeviceDocument, "offers" | "change">,
): DeviceOffers {
	return {
		list(nameOf) {
			return deviceOffers(document, nameOf);
		},
		set(entry: DeviceOfferEntry) {
			return setDeviceOffer(document, entry);
		},
		remove(spaceId, profile) {
			return removeDeviceOffer(document, spaceId, profile);
		},
	};
}
