import type { PairingCode } from "../domain/pairing";

/**
 * The driven ports of pairing. A port of its own has a real adapter, an
 * in-memory adapter and a contract suite in `adapters/out/`.
 */

/**
 * The pairing codes of the device authorization plugin. A Person's call
 * (`verify`, `approve`, `deny`) carries their session in the headers, and
 * throws the plugin's refusal in the Person's words (`pairingRefusalOf`).
 */
export type DeviceAuthorizations = {
	/** A new code for the Device (its id is the client id), with that scope. */
	start(deviceId: string, scope: string): Promise<PairingCode>;
	/**
	 * The Device's poll: the plugin's session token once the code is
	 * approved, else the OAuth error code of the poll (null: no such code).
	 */
	poll(code: {
		deviceCode: string;
		deviceId: string;
	}): Promise<{ token: string } | { error: string | null }>;
	/** The Person of the plugin's session token, or null. */
	personOfToken(token: string): Promise<string | null>;
	/** Deletes the plugin's session of that token. */
	forgetToken(token: string): Promise<void>;
	/** Binds the code to the Person who reviews it first: its status and client, for them alone. */
	verify(
		headers: Headers,
		userCode: string,
	): Promise<{ status: string; clientId: string | null }>;
	approve(headers: Headers, userCode: string): Promise<void>;
	deny(headers: Headers, userCode: string): Promise<void>;
};
