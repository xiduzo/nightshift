import { Refusal } from "@nightshift/refusal";

/** The refusal of a Device that joined this Host as a guest: its Personal secrets stay with its Home Host. */
export const NOT_YOUR_HOME_HOST =
	"This computer keeps no Personal secrets for you. They stay with your home Host.";

/** How long one call for the Personal secrets may take before a step reads them as missing. */
export const PERSONAL_DEADLINE_MS = 20_000;

/**
 * The Person whose secrets a calling Device may use: its own, when this
 * is its Home Host. A Guest Host keeps no Personal secret and gives none.
 */
export function ownerOf(caller: {
	personId: string;
	device: { homeHost: string | null };
}): string {
	if (caller.device.homeHost === null) {
		throw new Refusal("forbidden", NOT_YOUR_HOME_HOST);
	}
	return caller.personId;
}
