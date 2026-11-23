import { requireHost } from "../domain/host";
import type { HostSettings, Pairings } from "./ports";

export type DenyPairingPorts = {
	pairings: Pick<Pairings, "denyPairing">;
	settings: Pick<HostSettings, "isHost">;
};

export type DenyPairing = { headers: Headers; userCode: string };

/** Denies a pairing code. The Device stops waiting. */
export const denyPairing =
	(ports: DenyPairingPorts) =>
	async (request: DenyPairing): Promise<void> => {
		requireHost(ports.settings.isHost());
		await ports.pairings.denyPairing(request.headers, request.userCode);
	};
