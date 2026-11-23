import { Refusal } from "@nightshift/refusal";
import {
	type DevicePresence,
	REMOVE_ACCESS_FIRST,
} from "../domain/paired-device";
import type { DeviceStore, EngineDeviceRows } from "./ports";

export type ForgetDevicePorts = {
	store: Pick<DeviceStore, "paired" | "forget">;
	engineRows: Pick<EngineDeviceRows, "forget">;
	/** The Devices online now: this use case changes it. */
	online: DevicePresence;
};

/** What the request asks for: the Device to forget. */
export type ForgetDevice = { id: string };

/**
 * Removes a Device whose access is gone, for good: its row, its Clones
 * here and the Device document this Host kept for it, in one batch.
 * Refused while it still has access. The runs it walked keep its name.
 * A Device this Host has no paired row of changes nothing.
 *
 * The Host asks it: the use case takes the request alone.
 */
export const forgetDevice =
	(ports: ForgetDevicePorts) =>
	async (request: ForgetDevice): Promise<void> => {
		const { id } = request;
		const found = await ports.store.paired(id);
		if (!found) return;
		if (!found.revokedAt) throw new Refusal("conflict", REMOVE_ACCESS_FIRST);
		ports.online.delete(id);
		// The engine's statements first: its Clones, then its Device document.
		await ports.store.forget(id, ports.engineRows.forget(id));
	};
