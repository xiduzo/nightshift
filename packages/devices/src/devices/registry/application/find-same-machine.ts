import { type PairedDevice, toPaired } from "../domain/paired-device";
import type { DeviceStore } from "./ports";

export type FindSameMachinePorts = {
	store: Pick<DeviceStore, "sameMachine">;
	/** The Devices online now (`DevicePresence`). */
	online: ReadonlyMap<string, number>;
};

/** What the request asks for: the owner, the fingerprint, and the Device that asks. */
export type FindSameMachine = {
	ownerId: string;
	machine: string;
	exceptId: string;
};

/**
 * The Person's Device on the computer of this fingerprint, other than
 * `exceptId`: the one with access first, then the one seen last. A
 * removed Device counts: pairing again brings it back. Never another
 * Person's, a development install or this Host's own.
 *
 * The Host asks it: the use case takes the request alone.
 */
export const findSameMachine =
	(ports: FindSameMachinePorts) =>
	async (request: FindSameMachine): Promise<PairedDevice | null> => {
		const found = await ports.store.sameMachine(
			request.ownerId,
			request.machine,
			request.exceptId,
		);
		return found ? toPaired(found, ports.online) : null;
	};
