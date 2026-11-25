import { throughOffers } from "./acts-for";

/** The Devices that other Persons offer to a Space. */

type Offer = {
	deviceId: string;
	deviceName: string;
	profile: string;
	profileName: string;
};

/** A profile as a Person picks it. */
type Choice = { id: string; name: string; kind: "agent" };

/** The profiles of a Device that its Offers let a Person use: their names, as a flow names them, and each as a Person picks it. */
export type Offered = { offers: string[]; profiles: Choice[] };

/** What these Offers of one Device let a Person use. Only an Agent Profile is offered. */
export function offered(
	offers: readonly Pick<Offer, "profile" | "profileName">[],
): Offered {
	return {
		offers: offers.map((o) => o.profileName),
		profiles: offers.map((o) => ({
			id: o.profile,
			name: o.profileName,
			kind: "agent",
		})),
	};
}

/** The Devices of a Space's Offers, each once and in the order of their first Offer, without the ones `known`. */
export function offeringDevices(
	offers: readonly Offer[],
	known: ReadonlySet<string>,
): ({ deviceId: string; name: string } & Offered)[] {
	const byDevice = new Map<string, Offer[]>();
	for (const offer of offers) {
		if (known.has(offer.deviceId)) continue;
		const own = byDevice.get(offer.deviceId);
		if (own) own.push(offer);
		else byDevice.set(offer.deviceId, [offer]);
	}
	return [...byDevice].map(([deviceId, own]) => ({
		deviceId,
		name: own[0]?.deviceName ?? "",
		...offered(own),
	}));
}

/** Whether a Person may see an offering Device as another Person's: its access stands and it is not their own. One that never paired here counts. */
export function standsOffered(
	paired: { ownerId: string; revokedAt: number | null } | null,
	personId: string,
): boolean {
	return (
		!paired ||
		(paired.revokedAt === null && throughOffers(personId, paired.ownerId))
	);
}
