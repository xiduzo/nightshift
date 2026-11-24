import { Refusal } from "@nightshift/refusal";
import type { SecretMove } from "../../../contract";
import type { HostCalls } from "../../calls";
import { NOT_YOUR_OTHER_DEVICE } from "../domain/secret-moves";
import type { OtherDevices } from "./ports";
import type { RelaySecretMove } from "./relay-secret-move";

export type MoveOnDevicePorts = {
	devices: OtherDevices;
	/** The relay to the Device with the value (`relaySecretMove`). */
	relay(request: RelaySecretMove): Promise<void>;
	calls: Pick<HostCalls, "home" | "ask">;
	/** The Person who owns this computer: the only one who asks through it. */
	ownerId: string;
	/** How long a Home Host waits for the Device to move its secret. */
	deadlineMs: number;
};

/** The other Device, the secret saved there, and its move. */
export type MoveOnDevice = { deviceId: string; name: string; move: SecretMove };

/**
 * Asks one of the owner's other Devices to move a secret saved there.
 * A Device that calls this computer home gets the call from this
 * computer's own hub. Any other goes through this computer's Home Host,
 * with this computer's key: the Host checks the rest. Resolves when that
 * Device moved it.
 *
 * The owner's browser asks this computer: the use case takes the request alone.
 */
export const moveOnDevice =
	(ports: MoveOnDevicePorts) =>
	async (request: MoveOnDevice): Promise<void> => {
		const input = {
			deviceId: request.deviceId,
			name: request.name,
			move: request.move,
		};
		const paired = await ports.devices.get(input.deviceId);
		if (paired?.homeHost && paired.ownerId === ports.ownerId) {
			return ports.relay({ personId: ports.ownerId, ...input });
		}
		const home = await ports.calls.home();
		if (!home) throw new Refusal("not-found", NOT_YOUR_OTHER_DEVICE);
		await ports.calls.ask(
			home.hostId,
			(client) => client.secrets.moveOnDevice(input),
			// The Host waits for the Device first.
			{ deadlineMs: ports.deadlineMs + 10_000 },
		);
	};
