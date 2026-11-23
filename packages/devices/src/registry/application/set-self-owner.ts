import { NO_SELF_ROW } from "../domain/paired-device";
import type { DeviceStore } from "./ports";

export type SetSelfOwnerPorts = {
	store: Pick<DeviceStore, "selfId" | "setOwner">;
};

/** What the request asks for: the Person who owns this computer now. */
export type SetSelfOwner = { personId: string };

/**
 * Names the Person who owns this computer's Device (`localPerson`). Throws
 * when this computer has no Device row yet.
 *
 * Night Shift asks it: the use case takes the request alone.
 */
export const setSelfOwner =
	(ports: SetSelfOwnerPorts) =>
	async (request: SetSelfOwner): Promise<void> => {
		const id = await ports.store.selfId();
		if (id === null) throw new Error(NO_SELF_ROW);
		await ports.store.setOwner(id, request.personId);
	};
