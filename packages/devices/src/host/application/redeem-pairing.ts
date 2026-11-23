import type { PairingRedeemed } from "../../contract";
import { requireHost } from "../domain/host";
import {
	adoptedTwin,
	refuseOnlineTwin,
	twinMachine,
} from "../domain/pairing-rules";
import type { PendingPairings } from "../domain/pending";
import { DEFAULT_DEVICE_NAME } from "../domain/words";
import type {
	DeviceKeys,
	HostSettings,
	Pairings,
	PersonSpaces,
	Registry,
} from "./ports";

export type RedeemPairingPorts = {
	pairings: Pick<Pairings, "redeemPairing">;
	keys: Pick<DeviceKeys, "issue">;
	registry: Pick<Registry, "sameMachine" | "join" | "lastWalkerSeq">;
	spaces: Pick<PersonSpaces, "isHostAdmin">;
	settings: Pick<HostSettings, "isHost" | "hostAddresses">;
	pending: PendingPairings;
	self: { id: string; name: string };
};

export type RedeemPairing = {
	deviceCode: string;
	deviceId: string;
	home: boolean;
	address: string;
};

/**
 * A joining Device polls for the answer. On approval it gets its key,
 * and a home Device of the same owner on the same computer gets that
 * Device back (ADR 20).
 */
export const redeemPairing =
	(ports: RedeemPairingPorts) =>
	async (request: RedeemPairing): Promise<PairingRedeemed> => {
		requireHost(ports.settings.isHost());
		const answer = await ports.pairings.redeemPairing({
			deviceCode: request.deviceCode,
			deviceId: request.deviceId,
		});
		if (answer.status !== "approved") {
			if (answer.status === "denied" || answer.status === "expired") {
				ports.pending.delete(request.deviceCode);
			}
			return { status: answer.status };
		}
		const asked = ports.pending.get(request.deviceCode);
		ports.pending.delete(request.deviceCode);
		const machine = twinMachine(request.home, asked?.machine);
		const twin = machine
			? await ports.registry.sameMachine(
					answer.personId,
					machine,
					request.deviceId,
				)
			: null;
		refuseOnlineTwin(twin, ports.self.name);
		const adopted = adoptedTwin(twin, ports.self.id);
		const paired = await ports.registry.join({
			id: adopted?.id ?? request.deviceId,
			name: asked?.name ?? DEFAULT_DEVICE_NAME,
			platform: asked?.platform ?? "unknown",
			ownerId: answer.personId,
			homeHost: request.home ? request.address : null,
			machine,
		});
		const { key } = await ports.keys.issue({
			personId: answer.personId,
			deviceId: paired.id,
			deviceName: paired.name,
		});
		return {
			status: "joined",
			key,
			personId: answer.personId,
			deviceId: paired.id,
			...(adopted
				? { walkerSeq: await ports.registry.lastWalkerSeq(adopted.id) }
				: {}),
			host: {
				id: ports.self.id,
				name: ports.self.name,
				addresses: ports.settings.hostAddresses(),
			},
			hostAdmin: await ports.spaces.isHostAdmin(answer.personId),
		};
	};
