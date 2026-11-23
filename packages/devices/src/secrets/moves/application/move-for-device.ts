import { Refusal } from "@nightshift/refusal";
import type { Caller, SecretMove } from "../../../contract";
import {
	CANNOT_MOVE,
	moveHere,
	NOT_HOME_FOR_MOVES,
	NOT_YOUR_OTHER_DEVICE,
} from "../domain/secret-moves";
import type { OwnSecrets } from "./ports";
import type { RelaySecretMove } from "./relay-secret-move";

export type MoveForDevicePorts = {
	/** The relay to the Device with the value (`relaySecretMove`). */
	relay(request: RelaySecretMove): Promise<void>;
	/**
	 * This Host as a Device of its owner: its Devices list it among their
	 * owner's other Devices, and it moves its own secrets itself.
	 */
	self: { id: string; ownerId: string };
	/** This Host's own secrets. Without them, it moves none. */
	own: OwnSecrets | undefined;
};

/** The other Device, the secret saved there, and its move. */
export type MoveForDevice = {
	deviceId: string;
	name: string;
	move: SecretMove;
};

/**
 * This computer as a Home Host, as a paired Device asks it to move a
 * secret on another Device of the same Person. The Host admitted the
 * Caller before the call reached here (`Devices.admit`). This use case
 * adds one check: the Caller calls this Host home. A secret on the Home
 * Host computer itself moves here, for its owner.
 *
 * A paired Device asks: the use case takes the Caller.
 */
export const moveForDevice =
	(ports: MoveForDevicePorts) =>
	async (caller: Caller, request: MoveForDevice): Promise<void> => {
		if (caller.device.homeHost === null) {
			throw new Refusal("forbidden", NOT_HOME_FOR_MOVES);
		}
		const { self } = ports;
		if (request.deviceId !== self.id) {
			return ports.relay({ personId: caller.personId, ...request });
		}
		// The secret is on this Host: its owner's, moved here.
		if (self.ownerId !== caller.personId) {
			throw new Refusal("not-found", NOT_YOUR_OTHER_DEVICE);
		}
		if (!ports.own) throw new Refusal("unavailable", CANNOT_MOVE);
		await moveHere(ports.own, self.ownerId, request.name, request.move);
	};
