import type { Database } from "@nightshift/db";
import type { Auth } from "./auth";
import { type DeviceKeys, wireDeviceKeys } from "./device-keys";
import {
	type PairingAnswer,
	type PairingCode,
	type PairingReview,
	wirePairing,
} from "./pairing";

/**
 * The Device keys and the pairing of Devices, for the callers that hand
 * over the Better Auth instance per call. Each function wires its slice
 * (`device-keys/`, `pairing/`) and runs one of its use cases. Lane A4
 * switches the callers to one wire each and removes these.
 */

/** The Device keys of this Host: one memory of the keys checked lately per call. */
export function createDeviceKeys(options: {
	auth: Auth;
	db: Database;
	/** How many days a key may go unused. Read on every issue and use. */
	idleDays?: () => number;
}): DeviceKeys {
	return wireDeviceKeys(options);
}

/** A new pairing code for the Device. */
export function startPairing(
	auth: Auth,
	deviceId: string,
): Promise<PairingCode> {
	return wirePairing({ auth }).startPairing({ deviceId });
}

/** The answer to the Device's code so far. The device code is used up on approval. */
export function redeemPairing(
	auth: Auth,
	input: { deviceCode: string; deviceId: string },
): Promise<PairingAnswer> {
	return wirePairing({ auth }).redeemPairing(input);
}

/**
 * The code, for the Person whose session `headers` carry. The first Person
 * who reviews a pending code holds it: for anyone else it is refused.
 */
export function reviewPairing(
	auth: Auth,
	headers: Headers,
	userCode: string,
): Promise<PairingReview> {
	return wirePairing({ auth }).reviewPairing({ headers, userCode });
}

/** Approves a code the Person reviewed. Refused for another Person's code. */
export function approvePairing(
	auth: Auth,
	headers: Headers,
	userCode: string,
): Promise<void> {
	return wirePairing({ auth }).approvePairing({ headers, userCode });
}

/** Denies a code the Person reviewed. The Device stops waiting. */
export function denyPairing(
	auth: Auth,
	headers: Headers,
	userCode: string,
): Promise<void> {
	return wirePairing({ auth }).denyPairing({ headers, userCode });
}
