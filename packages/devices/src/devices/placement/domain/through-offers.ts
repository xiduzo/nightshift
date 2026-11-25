/** Who uses a Device through its Offers: a Person who does not own it. */

/** Another Person's Device takes the work of a Person through its Offers only. */
export function throughOffers(
	personId: string | null,
	ownerId: string | null,
): boolean {
	return personId !== null && personId !== ownerId;
}

/**
 * Whether a list of Devices has a Device as another Person's: it names what
 * the Device offers, also when that is nothing.
 */
export function listedThroughOffers(device: {
	offers?: readonly string[];
}): boolean {
	return device.offers !== undefined;
}
