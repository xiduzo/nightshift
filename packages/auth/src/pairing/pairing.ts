import { deviceAuthorization } from "better-auth/plugins/device-authorization";

import type { Auth } from "../auth";

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

/**
 * The device authorization plugin, typed by name: its inferred type names a
 * type `better-call` does not export, which a declaration cannot name.
 */
export interface PairingPlugin
	extends ReturnType<typeof deviceAuthorization<undefined>> {}

/** The device authorization plugin, as `createAuth` adds it. */
export function pairingPlugin(): PairingPlugin {
	return deviceAuthorization({
		expiresIn: PAIRING_CODE_TTL,
		interval: PAIRING_POLL_INTERVAL,
		// The client is the joining Device: its id.
		validateClient: (clientId) => /^[\w-]{1,64}$/.test(clientId),
	});
}

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

/** A new pairing code for the Device. */
export async function startPairing(
	auth: Auth,
	deviceId: string,
): Promise<PairingCode> {
	const code = await auth.api.deviceCode({
		body: { client_id: deviceId, scope: PAIRING_SCOPE },
	});
	return {
		deviceCode: code.device_code,
		userCode: code.user_code,
		expiresIn: code.expires_in,
		interval: code.interval,
	};
}

/** The answer to the Device's code so far. The device code is used up on approval. */
export async function redeemPairing(
	auth: Auth,
	input: { deviceCode: string; deviceId: string },
): Promise<PairingAnswer> {
	let token: string;
	try {
		const answer = await auth.api.deviceToken({
			body: {
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				device_code: input.deviceCode,
				client_id: input.deviceId,
			},
		});
		token = answer.access_token;
	} catch (error) {
		switch (oauthError(error)) {
			case "authorization_pending":
				return { status: "pending" };
			case "slow_down":
				return { status: "slow-down" };
			case "access_denied":
				return { status: "denied" };
			case "expired_token":
				return { status: "expired" };
			default:
				throw new Error(
					"This pairing code is not valid. Start the pairing again.",
				);
		}
	}
	const context = await auth.$context;
	const found = await context.internalAdapter.findSession(token);
	await context.internalAdapter.deleteSession(token);
	if (!found) throw new Error("The pairing ended without a person.");
	return { status: "approved", personId: found.user.id };
}

/**
 * The code, for the Person whose session `headers` carry. The first Person
 * who reviews a pending code holds it: for anyone else it is refused.
 */
export async function reviewPairing(
	auth: Auth,
	headers: Headers,
	userCode: string,
): Promise<PairingReview> {
	const code = normalizeUserCode(userCode);
	const review = await auth.api
		.deviceVerify({ headers, query: { user_code: code } })
		.catch((error) => {
			throw readable(error);
		});
	// The plugin names the client only to the Person who holds the code.
	if (!review.client_id) throw new Error(NOT_YOURS);
	return {
		userCode: code,
		status: review.status as PairingReview["status"],
		deviceId: review.client_id,
	};
}

/** Approves a code the Person reviewed. Refused for another Person's code. */
export async function approvePairing(
	auth: Auth,
	headers: Headers,
	userCode: string,
): Promise<void> {
	await auth.api
		.deviceApprove({ headers, body: { userCode: normalizeUserCode(userCode) } })
		.catch((error) => {
			throw readable(error);
		});
}

/** Denies a code the Person reviewed. The Device stops waiting. */
export async function denyPairing(
	auth: Auth,
	headers: Headers,
	userCode: string,
): Promise<void> {
	await auth.api
		.deviceDeny({ headers, body: { userCode: normalizeUserCode(userCode) } })
		.catch((error) => {
			throw readable(error);
		});
}

/** "abcd-efgh" and "ABCDEFGH" are one code. */
export function normalizeUserCode(userCode: string): string {
	return userCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

const NOT_YOURS =
	"Another person is approving this code. Ask them, or start the pairing again on the device.";

/** The OAuth error code of a device authorization error, if it is one. */
function oauthError(error: unknown): string | null {
	const body = (error as { body?: { error?: unknown } } | null)?.body;
	return typeof body?.error === "string" ? body.error : null;
}

/** The plugin's errors, in words for the Person approving. */
function readable(error: unknown): Error {
	const status = (error as { status?: unknown } | null)?.status;
	if (status === "UNAUTHORIZED") {
		return new Error("Sign in to approve a device.");
	}
	if (status === "FORBIDDEN") return new Error(NOT_YOURS);
	switch (oauthError(error)) {
		case "invalid_request": {
			const text = String(
				(error as { body?: { error_description?: unknown } }).body
					?.error_description ?? "",
			);
			if (/processed/i.test(text)) {
				return new Error("This code was already used.");
			}
			if (/claimed/i.test(text)) {
				return new Error("Enter the code first, then approve it.");
			}
			return new Error(
				"No device waits with this code. Check the code and try again.",
			);
		}
		case "expired_token":
			return new Error(
				"This code has expired. Start the pairing again on the device.",
			);
		case "access_denied":
			return new Error(NOT_YOURS);
		default:
			return error instanceof Error ? error : new Error(String(error));
	}
}
