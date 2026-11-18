/** Offers: a profile of a Device made available to a Space, its caps, and the rules that check it. */

export {
	createOfferAdmission,
	NO_STARTER,
	type OfferAdmission,
} from "./admission";
export {
	createEngineOffers,
	createOfferedSessions,
	type EngineOffers,
} from "./engine-offers";
export { createOfferUse, type OfferUse } from "./offer-use";
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
