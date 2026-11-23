/**
 * Offers: a profile of a Device made available to a Space, its caps, and
 * the rules that check it. `wireOffers` (also `createOffers`) builds the
 * owner's door, the Space publication, the admission and the schedule check.
 */

export type { OfferAdmission } from "./application/admit-offered-call";
export type { OfferView } from "./application/list-offers";
export type { SpaceDeviceView } from "./application/list-space-devices";
export { createOfferUse, type OfferUse } from "./domain/offer-use";
export { NO_STARTER } from "./domain/offered-call";
export {
	type DeviceOffer,
	deviceOffers,
	hostOffersNothing,
	offeredProfile,
	offerRefusal,
	offersNothing,
	offerTakes,
	spaceOffers,
} from "./domain/offers";
export {
	type EngineOffers,
	type Offers,
	wireOffers,
	wireOffers as createOffers,
} from "./wire";
