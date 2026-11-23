import { Refusal } from "@nightshift/refusal";
import {
	type JoinRow,
	NOT_RECORDED,
	PAIR_WITH_ITSELF,
	type PairedDevice,
	spaceOfOwner,
	toPaired,
} from "../domain/paired-device";
import type { DeviceFacts, DeviceStore, PersonalSpaces } from "./ports";

export type JoinDevicePorts = {
	store: Pick<DeviceStore, "selfId" | "joinRows" | "paired">;
	facts: DeviceFacts;
	spaces: PersonalSpaces;
	/** The Devices online now (`DevicePresence`). */
	online: ReadonlyMap<string, number>;
};

/** What the request asks for: the Device that paired. */
export type JoinDevice = JoinRow;

/**
 * Records a Device that paired with this Host, or paired again: its row
 * (access back on), and `DeviceJoined` in its owner's personal Space, in
 * one batch. A Device id that is this Host's own is refused.
 *
 * The Host asks it for a pairing it approved: the use case takes the request alone.
 */
export const joinDevice =
	(ports: JoinDevicePorts) =>
	async (request: JoinDevice): Promise<PairedDevice> => {
		const { store } = ports;
		if ((await store.selfId()) === request.id) {
			throw new Refusal("invalid", PAIR_WITH_ITSELF);
		}
		// The row and its event are one batch.
		await ports.facts.log(
			{
				type: "DeviceJoined",
				payload: {
					deviceId: request.id,
					name: request.name,
					platform: request.platform,
					ownerId: request.ownerId,
					home: request.homeHost !== null,
				},
				spaceId: await spaceOfOwner(ports.spaces.idOf, request.ownerId),
			},
			store.joinRows(request),
		);
		const joined = await store.paired(request.id);
		if (!joined) throw new Error(NOT_RECORDED);
		return toPaired(joined, ports.online);
	};
