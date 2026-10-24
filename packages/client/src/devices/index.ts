/** Devices, pairing and Offers: their query options and view types. */

export { platformName } from "./platform";
export {
	createDeviceMutations,
	createDeviceQueries,
	createOfferMutations,
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
