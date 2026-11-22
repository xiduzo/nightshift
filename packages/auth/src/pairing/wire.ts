import type { Auth } from "../auth";
import { betterAuthDeviceAuthorizations } from "./adapters/out/better-auth-device-authorizations";
import { approvePairing } from "./application/approve-pairing";
import { denyPairing } from "./application/deny-pairing";
import { redeemPairing } from "./application/redeem-pairing";
import { reviewPairing } from "./application/review-pairing";
import { startPairing } from "./application/start-pairing";

/**
 * The wiring of pairing: the one place that builds its real adapter and
 * binds each use case to its ports.
 */

/** What the package gives pairing: what the real adapter stands on. */
export type PairingDeps = {
	auth: Auth;
};

/** The use cases of pairing, bound to their ports. */
export type Pairing = {
	/** A new pairing code for the Device. */
	startPairing: ReturnType<typeof startPairing>;
	/** The answer to the Device's code so far. */
	redeemPairing: ReturnType<typeof redeemPairing>;
	/** The code, for the Person who reviews it: the first one holds it. */
	reviewPairing: ReturnType<typeof reviewPairing>;
	/** Approves a code the Person reviewed. */
	approvePairing: ReturnType<typeof approvePairing>;
	/** Denies a code the Person reviewed. */
	denyPairing: ReturnType<typeof denyPairing>;
};

export function wirePairing(deps: PairingDeps): Pairing {
	const ports = {
		deviceAuthorizations: betterAuthDeviceAuthorizations(deps.auth),
	};
	return {
		startPairing: startPairing(ports),
		redeemPairing: redeemPairing(ports),
		reviewPairing: reviewPairing(ports),
		approvePairing: approvePairing(ports),
		denyPairing: denyPairing(ports),
	};
}
