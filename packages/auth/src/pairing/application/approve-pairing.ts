import { normalizeUserCode } from "../domain/pairing";
import type { DeviceAuthorizations } from "./ports";

export type ApprovePairingPorts = {
	deviceAuthorizations: Pick<DeviceAuthorizations, "approve">;
};

/** The Person's session (in the headers), and the code they approve. */
export type ApprovePairing = { headers: Headers; userCode: string };

/** Approves a code the Person reviewed. Refused for another Person's code. */
export const approvePairing =
	(ports: ApprovePairingPorts) =>
	async (request: ApprovePairing): Promise<void> => {
		await ports.deviceAuthorizations.approve(
			request.headers,
			normalizeUserCode(request.userCode),
		);
	};
