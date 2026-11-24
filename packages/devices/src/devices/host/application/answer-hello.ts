import type { DeviceKeyAccess } from "@nightshift/auth";
import { PROTOCOL_VERSION, Refusal } from "@nightshift/refusal";
import type { HostHello } from "../../../contract";
import {
	isHomeDevice,
	ownDevicesForHello,
	spacesForHello,
} from "../domain/hello";
import { requireHost } from "../domain/host";
import { NO_ACCESS } from "../domain/words";
import type { HostSettings, PersonSpaces, Registry } from "./ports";

export type AnswerHelloPorts = {
	registry: Pick<Registry, "get" | "list" | "seen" | "selfOwnerId">;
	spaces: PersonSpaces;
	settings: HostSettings;
	self: { id: string; name: string };
};

/** A paired Device's link answered: it is online. */
export const answerHello =
	(ports: AnswerHelloPorts) =>
	async (key: DeviceKeyAccess): Promise<HostHello> => {
		requireHost(ports.settings.isHost());
		const paired = await ports.registry.get(key.deviceId);
		if (!paired || paired.revokedAt) {
			throw new Refusal("forbidden", NO_ACCESS);
		}
		await ports.registry.seen(key.deviceId);
		const spaces = await ports.spaces.of(key.personId);
		const home = isHomeDevice(paired.homeHost);
		const ownerOwnsHost = (await ports.registry.selfOwnerId()) === key.personId;
		const others = home ? await ports.registry.list(key.personId) : [];
		return {
			host: {
				id: ports.self.id,
				name: ports.self.name,
				addresses: ports.settings.hostAddresses(),
			},
			version: PROTOCOL_VERSION,
			deviceId: key.deviceId,
			personId: key.personId,
			spaces: spacesForHello(spaces, home),
			hostAdmin: await ports.spaces.isHostAdmin(key.personId),
			...(home
				? {
						devices: ownDevicesForHello(
							others,
							ports.self,
							ownerOwnsHost,
							key.deviceId,
						),
					}
				: {}),
		};
	};
