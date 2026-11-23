/**
 * The words this computer as a Host says, as literals a person reads.
 */

/** A Device that asks this Host to pair with itself. */
export const SELF_PAIR = "A computer cannot pair with itself." as const;

/** A Device whose Person does not own it here, or that this Host has no row of. */
export const NOT_YOURS_HERE = "This device is not one of yours here." as const;

/** Forget while the Device still has access. */
export const REMOVE_ACCESS_FIRST =
	"Remove the access of this device first." as const;

/** The words of a key this Host does not take: none, or a Device without access. */
export const NO_ACCESS =
	"This device has no access here. Pair it again." as const;

/** A key that does not hold the permission the procedure names. */
export const NO_PERMISSION = "This device may not do this here." as const;

/** A role that does not allow the call, as the Host says it to a Device. */
export const ROLE_WORDS =
	"Your role in this Space does not allow this." as const;

/** The default name of a Device that did not say one when it asked for a code. */
export const DEFAULT_DEVICE_NAME = "Device" as const;

/**
 * The twin of this computer is still linked: pairing again is refused
 * until that Night Shift quits (ADR 20).
 */
export function twinOnlineWords(hostName: string, twinName: string): string {
	return `Night Shift on this computer is connected to ${hostName} as ${twinName}. Quit it, then pair again.`;
}
