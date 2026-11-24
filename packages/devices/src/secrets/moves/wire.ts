import type {
	Caller,
	SecretMove,
	WorkReply,
	WorkRequest,
} from "../../contract";
import type { HostCalls } from "../calls";
import { PERSONAL_DEADLINE_MS } from "../personal";
import { moveForDevice } from "./application/move-for-device";
import { moveOnDevice } from "./application/move-on-device";
import { moveOwnSecret } from "./application/move-own-secret";
import type { MoveWork, OtherDevices, OwnSecrets } from "./application/ports";
import { relaySecretMove } from "./application/relay-secret-move";

/**
 * The wiring of the moves of a secret saved on another of the Person's
 * Devices (ADR 13, decision 7). It binds each use case to its ports. It
 * builds no adapter of its own. Three halves, one per computer: the
 * Device that asks, the Home Host that relays, and the Device that moves
 * its own value. The value never leaves that Device except to the Host
 * that keeps the new scope. It never passes through the Device that asks.
 */

/**
 * How long a Home Host waits for the Device to move its secret. The
 * Device's own save at its Host may take `PERSONAL_DEADLINE_MS`.
 */
const MOVE_DEADLINE_MS = PERSONAL_DEADLINE_MS + 25_000;

/** What the composition gives the moves first: this computer's own secrets and its Hosts. */
export type MovesDeps = {
	calls: HostCalls;
	/** This computer's own secrets. Without them, it moves none. */
	own: OwnSecrets | undefined;
	/** The Person who owns this computer. */
	ownerId: string;
};

/** What the composition gives the moves once the engine is there. */
export type RelayDeps = {
	/** The Devices paired with this Host. */
	devices: OtherDevices;
	/** This Host's work hub: a Device takes its calls over its own stream. */
	work: MoveWork;
	/** This computer's Device. */
	selfId: string;
	/** How long a Home Host waits for the Device. Default: `MOVE_DEADLINE_MS`. */
	deadlineMs?: number;
};

/** The Device that asks: the browser's move, as this computer passes it on. */
export type SecretMoves = {
	/**
	 * Asks one of the owner's other Devices to move a secret saved there.
	 * Resolves when that Device moved it. Refuses when it is offline,
	 * or not one of the owner's.
	 */
	move(deviceId: string, name: string, move: SecretMove): Promise<void>;
};

/** The Home Host's half, as the router serves it. */
export type SecretMovesHost = {
	move(
		caller: Caller,
		input: { deviceId: string; name: string; move: SecretMove },
	): Promise<void>;
};

/** The moves: the Device with the value serves its Home Host's call from the start; the rest once the engine is there. */
export type Moves = {
	/** Serves a secret call that came over this computer's link to `via.hostId`. Never throws. */
	serve(
		request: WorkRequest,
		via: { hostId: string },
	): AsyncGenerator<WorkReply>;
	relay(deps: RelayDeps): { host: SecretMovesHost; device: SecretMoves };
};

export function wireMoves(deps: MovesDeps): Moves {
	const { calls, own, ownerId } = deps;
	const serve = moveOwnSecret({ calls, own, ownerId });
	return {
		serve: (request, via) => serve({ request, hostId: via.hostId }),
		relay(late) {
			const deadlineMs = late.deadlineMs ?? MOVE_DEADLINE_MS;
			const relay = relaySecretMove({
				devices: late.devices,
				work: late.work,
				deadlineMs,
			});
			const forDevice = moveForDevice({
				relay,
				self: { id: late.selfId, ownerId },
				own,
			});
			const onDevice = moveOnDevice({
				devices: late.devices,
				relay,
				calls,
				ownerId,
				deadlineMs,
			});
			return {
				host: { move: forDevice },
				device: {
					move: (deviceId, name, move) => onDevice({ deviceId, name, move }),
				},
			};
		},
	};
}
