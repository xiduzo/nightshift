import { Refusal } from "@nightshift/refusal";

/**
 * Pairing a Device with a Host, by device authorization (RFC 8628, Better
 * Auth's device authorization plugin):
 *
 * 1. The joining Device asks the Host for a code (`startPairing`), with its
 *    own id as the client id, and shows the user code to its Person.
 * 2. The Person, signed in on the Host, enters the code: `reviewPairing`
 *    binds the code to them (only they can approve it from then on), and
 *    `approvePairing` or `denyPairing` answers it.
 * 3. The Device polls `redeemPairing` until the answer comes. On approval
 *    it learns the approving Person; the Host then gives it a Device key
 *    (`device-keys/`). The plugin's own session token is never handed
 *    out: it is deleted the moment it is made.
 *
 * Better Auth 1.6.11 or later binds a code to the first Person who reviews
 * it (CVE-2026-45337 let another Person approve it in 1.6.0 to 1.6.10).
 */

/** How long a pairing code stays valid. */
export const PAIRING_CODE_TTL = "15m";
/**
 * How often the Device asks for the answer. Short: a Person is typing the
 * code, and each ask is one small request.
 */
export const PAIRING_POLL_INTERVAL = "2s";
/** What a Device key may do, as the pairing asks for it. */
export const PAIRING_SCOPE = "sync relay archive";

export type PairingCode = {
	/** The Device's secret for polling. Never shown. */
	deviceCode: string;
	/** What the Person types on the Host. */
	userCode: string;
	/** Seconds until the code expires. */
	expiresIn: number;
	/** Seconds between two polls. */
	interval: number;
};

export type PairingAnswer =
	| { status: "pending" }
	| { status: "slow-down" }
	| { status: "denied" }
	| { status: "expired" }
	| { status: "approved"; personId: string };

/** A pairing code as the Person who reviews it sees it. */
export type PairingReview = {
	userCode: string;
	status: "pending" | "approved" | "denied";
	/** The joining Device's id. */
	deviceId: string;
};

/** "abcd-efgh" and "ABCDEFGH" are one code. */
export function normalizeUserCode(userCode: string): string {
	return userCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/** The words for a code another Person holds. */
export const NOT_YOURS =
	"Another person has this code open. Ask them, or start the pairing again on the device.";

/**
 * The answer while the Device waits, from the OAuth error code of its
 * poll. Any other code: the pairing code is not valid.
 */
export function waitingAnswer(oauthError: string | null): PairingAnswer {
	switch (oauthError) {
		case "authorization_pending":
			return { status: "pending" };
		case "slow_down":
			return { status: "slow-down" };
		case "access_denied":
			return { status: "denied" };
		case "expired_token":
			return { status: "expired" };
		default:
			throw new Refusal(
				"invalid",
				"This pairing code is not valid. Start the pairing again.",
			);
	}
}

/** The shape of a device authorization error that matters here. */
type PluginError = {
	status?: unknown;
	body?: { error?: unknown; error_description?: unknown };
};

/** The OAuth error code of a device authorization error, if it is one. */
export function oauthErrorOf(error: unknown): string | null {
	const body = (error as PluginError | null)?.body;
	return typeof body?.error === "string" ? body.error : null;
}

/**
 * The plugin's refusals of a Person's review, approval or denial, in words
 * for the Person approving. Any other error stays a failure.
 */
export function pairingRefusalOf(error: unknown): unknown {
	const status = (error as PluginError | null)?.status;
	if (status === "UNAUTHORIZED") {
		return new Refusal("signed-out", "Sign in to approve a device.");
	}
	if (status === "FORBIDDEN") return new Refusal("forbidden", NOT_YOURS);
	switch (oauthErrorOf(error)) {
		case "invalid_request": {
			const text = String((error as PluginError).body?.error_description ?? "");
			if (/processed/i.test(text)) {
				return new Refusal(
					"conflict",
					"Someone used this code already. Start the pairing again on the device.",
				);
			}
			if (/claimed/i.test(text)) {
				return new Refusal("invalid", "Enter the code first, then approve it.");
			}
			return new Refusal(
				"not-found",
				"No device waits with this code. Check the code and try again.",
			);
		}
		case "expired_token":
			return new Refusal(
				"conflict",
				"This code expired. Start the pairing again on the device.",
			);
		case "access_denied":
			return new Refusal("forbidden", NOT_YOURS);
		default:
			return error;
	}
}
