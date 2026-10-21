import type { WorkRelay } from "../contract";
import type { DeviceLinks } from "../links";
import type { PeerEngine } from "../peers";
import type { WorkHub } from "../work";
import { HOST_OFFLINE } from "./relay";

/**
 * How this computer's runs reach the Devices their steps are placed on.
 *
 * - A Space this Replica keeps (it is that Space's Host): the hub, which
 *   the placed Devices pull their calls from over their own links.
 * - A Space a Host keeps: the Walker → Host → Device leg. The call goes
 *   to the Host over this computer's link (`devices.call`), which relays it
 *   to the Device, or serves it itself; closing the stream cancels it. The
 *   Host checks the Device is the same Person's.
 */
export function createWorkRelay(deps: {
	hub: WorkHub;
	/** Lazy: the engine is made with this relay. */
	engine(): PeerEngine;
	links(): DeviceLinks;
}): WorkRelay {
	const hostOf = (spaceId: string) =>
		deps.engine().exchange.hostSpaces.hostOf(spaceId);

	async function clientOf(spaceId: string) {
		const hostId = await hostOf(spaceId);
		if (hostId === null) return null;
		return deps.links().get(hostId)?.client() ?? null;
	}

	return {
		async *call(deviceId, request, signal) {
			if ((await hostOf(request.spaceId)) === null) {
				yield* deps.hub.call(deviceId, request, signal);
				return;
			}
			const client = await clientOf(request.spaceId);
			if (!client) {
				yield { kind: "error", message: HOST_OFFLINE, offline: true };
				return;
			}
			try {
				const replies = await client.devices.call(
					{ deviceId, request },
					signal ? { signal } : {},
				);
				for await (const reply of replies) yield reply;
			} catch (error) {
				if (signal?.aborted) return;
				yield {
					kind: "error",
					message: `The computer that keeps this Space stopped answering: ${error instanceof Error ? error.message : String(error)}`,
					offline: true,
				};
			}
		},

		async online(deviceId, spaceId) {
			if ((await hostOf(spaceId)) === null) {
				return deps.hub.online(deviceId, spaceId);
			}
			const client = await clientOf(spaceId);
			if (!client) return false;
			return client.devices.reachable({ deviceId }).catch(() => false);
		},
	};
}
