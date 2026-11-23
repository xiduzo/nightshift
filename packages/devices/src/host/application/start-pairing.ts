import type { PairingStart } from "../../contract";
import { requireHost } from "../domain/host";
import { refuseSelfPair } from "../domain/pairing-rules";
import { type PendingPairings, prunePending } from "../domain/pending";
import type { HostSettings, Pairings } from "./ports";

export type StartPairingPorts = {
	pairings: Pick<Pairings, "startPairing">;
	settings: Pick<HostSettings, "isHost">;
	pending: PendingPairings;
	self: { id: string };
	devicesPage: string;
	fingerprint: string | null;
	now: () => number;
};

export type StartPairing = {
	deviceId: string;
	name: string;
	platform: string;
	home?: boolean;
	machine?: string;
};

/** A joining Device asks for a pairing code. Only a Host answers. */
export const startPairing =
	(ports: StartPairingPorts) =>
	async (request: StartPairing): Promise<PairingStart> => {
		requireHost(ports.settings.isHost());
		refuseSelfPair(ports.self.id, request.deviceId);
		prunePending(ports.pending, ports.now());
		const code = await ports.pairings.startPairing(request.deviceId);
		ports.pending.set(code.deviceCode, {
			...request,
			userCode: code.userCode,
			expiresAt: ports.now() + code.expiresIn * 1000,
		});
		const page = new URL(ports.devicesPage);
		const complete = new URL(page);
		complete.searchParams.set("pair", code.userCode);
		return {
			...code,
			verificationUri: page.toString(),
			verificationUriComplete: complete.toString(),
			fingerprint: ports.fingerprint,
		};
	};
