/**
 * One place a run can go, for the start of a run: a Device that can take
 * it now, or one of your Devices that is offline (shown, not chosen).
 */
export type PlacementChoice = {
	deviceId: string;
	name: string;
	/** The computer that answers the call: the Host, for a phone. */
	thisDevice: boolean;
	/** Another person's Device: the profiles it offers to this Space. */
	offers?: string[];
	/** The Host when another person owns it: their name. */
	ownerName?: string;
	online: boolean;
	/** The project's latest run ran on it. */
	lastRun?: boolean;
	/** Where a run goes when the person chooses none, as Night Shift decides it. */
	default?: boolean;
};

/**
 * What the Host is when another person runs it: whose it is, and what
 * they offer to this Space. Null for any other place.
 */
export function hostOwnerHint(
	choice: Pick<PlacementChoice, "thisDevice" | "offers" | "ownerName">,
): string | null {
	if (!choice.thisDevice || choice.offers === undefined) return null;
	const owner = choice.ownerName;
	if (!owner) {
		return choice.offers.length === 0
			? "This Host belongs to another person. It offers no profiles to this Space."
			: `This Host belongs to another person. It offers ${choice.offers.join(", ")} to this Space.`;
	}
	return choice.offers.length === 0
		? `This Host belongs to ${owner}. ${owner} has not offered it to this Space.`
		: `This Host belongs to ${owner}. ${owner} offers ${choice.offers.join(", ")} to this Space.`;
}
