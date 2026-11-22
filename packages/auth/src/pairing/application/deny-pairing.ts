import { normalizeUserCode } from "../domain/pairing";
import type { DeviceAuthorizations } from "./ports";

export type DenyPairingPorts = {
	deviceAuthorizations: Pick<DeviceAuthorizations, "deny">;
};

/** The Person's session (in the headers), and the code they deny. */
export type DenyPairing = { headers: Headers; userCode: string };

/** Denies a code the Person reviewed. The Device stops waiting. */
export const denyPairing =
	(ports: DenyPairingPorts) =>
	async (request: DenyPairing): Promise<void> => {
		await ports.deviceAuthorizations.deny(
			request.headers,
			normalizeUserCode(request.userCode),
		);
	};
