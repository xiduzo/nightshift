import { requireHost } from "../domain/host";
import type { HostSettings, Pairings } from "./ports";

export type ApprovePairingPorts = {
	pairings: Pick<Pairings, "approvePairing">;
	settings: Pick<HostSettings, "isHost">;
};

export type ApprovePairing = { headers: Headers; userCode: string };

/** Approves a pairing code: the Device joins as the Person's. */
export const approvePairing =
	(ports: ApprovePairingPorts) =>
	async (request: ApprovePairing): Promise<void> => {
		requireHost(ports.settings.isHost());
		await ports.pairings.approvePairing(request.headers, request.userCode);
	};
