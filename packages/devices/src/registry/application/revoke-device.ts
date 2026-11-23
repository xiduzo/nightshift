import { Refusal } from "@nightshift/refusal";
import {
	type DevicePresence,
	NOT_PAIRED,
	spaceOfOwner,
} from "../domain/paired-device";
import type { DeviceFacts, DeviceStore, PersonalSpaces } from "./ports";

export type RevokeDevicePorts = {
	store: Pick<DeviceStore, "paired" | "revokeRows">;
	facts: DeviceFacts;
	spaces: PersonalSpaces;
	/** The Devices online now: this use case changes it. */
	online: DevicePresence;
	now: () => number;
};

/** What the request asks for: the Device whose access goes. */
export type RevokeDevice = { id: string };

/**
 * Access removed: `DeviceRevoked` in one batch with the row, and
 * `DeviceOffline` when it was online. A Device whose access is gone
 * already changes nothing. One this Host has no paired row of is refused.
 *
 * The Host asks it: the use case takes the request alone.
 */
export const revokeDevice =
	(ports: RevokeDevicePorts) =>
	async (request: RevokeDevice): Promise<void> => {
		const { id } = request;
		const found = await ports.store.paired(id);
		if (!found) throw new Refusal("not-found", NOT_PAIRED);
		if (found.revokedAt) return;
		const spaceId = await spaceOfOwner(ports.spaces.idOf, found.ownerId);
		await ports.facts.log(
			{ type: "DeviceRevoked", payload: { deviceId: id }, spaceId },
			ports.store.revokeRows(id, ports.now()),
		);
		if (!ports.online.delete(id)) return;
		await ports.facts.log({
			type: "DeviceOffline",
			payload: { deviceId: found.id },
			spaceId: await spaceOfOwner(ports.spaces.idOf, found.ownerId),
		});
	};
