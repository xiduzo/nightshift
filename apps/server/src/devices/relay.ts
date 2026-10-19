import type { AppRouterClient } from "@nightshift/api/routers/index";
import type { DeviceRegistry } from "@nightshift/engine";
import type { Engine, Relay } from "@nightshift/engine/types";

import type { DeviceLinks } from "./links";

/**
 * The engine's `Relay`: the actions on rows another Device owns, carried
 * to the right place.
 *
 * - A Space this Replica keeps (it is that Space's Host): a command waits
 *   here for its Walker, a paired Device, which takes it over its link.
 * - A Space a Host keeps: the call goes to that Host over its link, with
 *   this Device's key; the Host checks the role of the key's Person. A
 *   Host that is offline refuses it: the person tries again later.
 */

export const HOST_OFFLINE =
	"The computer that keeps this Space cannot be reached. Try again when it is online.";

export function createRelay(deps: {
	/** Lazy: the engine is made with this relay. */
	engine(): Engine;
	registry(): DeviceRegistry;
	links(): DeviceLinks;
}): Relay {
	const hostOf = (spaceId: string) =>
		deps.engine().exchange.hostSpaces.hostOf(spaceId);

	async function hostClient(hostId: string): Promise<AppRouterClient> {
		const client = deps.links().get(hostId)?.client();
		if (!client) throw new Error(HOST_OFFLINE);
		return client;
	}

	return {
		async command(command) {
			const hostId = await hostOf(command.spaceId);
			if (hostId === null) {
				const walker = await deps.registry().get(command.walkerId);
				if (!walker || walker.revokedAt) {
					throw new Error(
						"The device that runs this run has no access to this computer.",
					);
				}
				await deps.engine().exchange.commands.enqueue(command);
				return;
			}
			const client = await hostClient(hostId);
			// The Host acts in the name of the key's Person, never a Person the call names.
			await client.sync.command(command);
		},

		async addClone(input) {
			const hostId = await hostOf(input.spaceId);
			if (hostId === null) throw new Error(HOST_OFFLINE);
			const client = await hostClient(hostId);
			await client.sync.addClone({
				spaceId: input.spaceId,
				projectId: input.projectId,
				deviceName: input.deviceName,
			});
		},

		async offer(input) {
			const hostId = await hostOf(input.spaceId);
			if (hostId === null) throw new Error(HOST_OFFLINE);
			const client = await hostClient(hostId);
			// The Host publishes it for the key's Device, in its Person's name.
			await client.sync.offer(input);
		},

		async withdrawOffer(input) {
			const hostId = await hostOf(input.spaceId);
			if (hostId === null) throw new Error(HOST_OFFLINE);
			const client = await hostClient(hostId);
			await client.sync.withdrawOffer(input);
		},

		async archive(ref) {
			const hostId = await hostOf(ref.spaceId);
			if (hostId === null) return null;
			const client = await hostClient(hostId);
			return client.archive.get({ ref });
		},

		async startRun(input) {
			const hostId = await hostOf(input.spaceId);
			if (hostId === null) throw new Error(HOST_OFFLINE);
			const client = await hostClient(hostId);
			// The Host starts it in the name of the key's Person.
			const { startedBy: _person, ...start } = input;
			return client.sync.startRun(start);
		},

		async placements(input) {
			const hostId = await hostOf(input.spaceId);
			if (hostId === null) return [];
			const client = await hostClient(hostId);
			return client.sync.placements(input);
		},
	};
}
