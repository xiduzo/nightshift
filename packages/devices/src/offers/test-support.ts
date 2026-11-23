import type {
	AdmissionDeps,
	OwnerDeps,
	PublicationDeps,
	ScheduleDeps,
} from "./wire";
import { wireOffers } from "./wire";

/** The owner's door, over the same deps the old `createOffers` took. */
export function createOffers(deps: OwnerDeps) {
	return wireOffers().createOffers(deps);
}

/** The Space-document Offers, over the same deps the old `createEngineOffers` took. */
export function createEngineOffers(deps: PublicationDeps) {
	return wireOffers().createEngineOffers(deps);
}

/** The admission, over the same deps the old `createOfferAdmission` took. */
export function createOfferAdmission(deps: AdmissionDeps) {
	return wireOffers().createOfferAdmission(deps);
}

/** The schedule check, over the same deps the old `createScheduleOffers` took. */
export function createScheduleOffers(deps: ScheduleDeps) {
	return wireOffers().createScheduleOffers(deps);
}
