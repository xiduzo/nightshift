/** Devices, pairing and Offers: their query options and view types. */

export { type KnownComputer, knownComputers, offlineNeeds } from "./needs";
export { platformName } from "./platform";
export {
	createDeviceQueries,
	createOfferQueries,
} from "./queries";
export type {
	DevicesOverview,
	LinkedHost,
	OfferView,
	PairedDevice,
	PairingReview,
	Phone,
	SpaceDevice,
	ThisComputer,
} from "./types";
