import { PAIRING_SCOPE, type PairingCode } from "../domain/pairing";
import type { DeviceAuthorizations } from "./ports";

export type StartPairingPorts = {
	deviceAuthorizations: Pick<DeviceAuthorizations, "start">;
};

/** Which Device joins. */
export type StartPairing = { deviceId: string };

/** A new pairing code for the Device. */
export const startPairing =
	(ports: StartPairingPorts) =>
	async (request: StartPairing): Promise<PairingCode> =>
		ports.deviceAuthorizations.start(request.deviceId, PAIRING_SCOPE);
