/** Offers: a profile of a Device made available to a Space, its caps, and the rules that check it. */

export {
	createEngineOffers,
	createOfferedSessions,
	createOffersHere,
	type EngineOffers,
} from "./engine-offers";
export {
	createOfferSlots,
	type DeviceOffer,
	deviceOffers,
	inForce,
	type OfferSlots,
	offeredCallRefusal,
	offeredSession,
	offerRefusal,
	offersNothing,
	slotKey,
	spaceOffers,
} from "./offers";
export { createOffers } from "./own-offers";
export { createScheduleOffers } from "./schedule-offers";
export type { Offers, OfferView, SpaceDeviceView } from "./types";
