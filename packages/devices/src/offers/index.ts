/** Offers: a profile of a Device made available to a Space, its caps, and the rules that check it. */

export {
	createOfferAdmission,
	createOfferUse,
	NO_STARTER,
	type OfferAdmission,
	type OfferUse,
} from "./admission";
export {
	createEngineOffers,
	createOfferedSessions,
	type EngineOffers,
} from "./engine-offers";
export {
	type DeviceOffer,
	deviceOffers,
	hostOffersNothing,
	offeredProfile,
	offerRefusal,
	offersNothing,
	offerTakes,
	spaceOffers,
} from "./offers";
export { createOffers } from "./own-offers";
export { createScheduleOffers } from "./schedule-offers";
export type { Offers, OfferView, SpaceDeviceView } from "./types";
