import { HostUnreachableError } from "@nightshift/engine";
import type { HostClient } from "../contract";
import type { DeviceLinks } from "../links";

/**
 * Where a call for a Space goes now:
 * - `here`: this Replica keeps the Space (it is that Space's Host).
 * - `host`: a Host keeps it, and its Link is online. `client` calls that
 *   Host with this Device's key.
 * - `unreachable`: a Host keeps it, and this computer has no online Link
 *   to it now (no Link, or the Link is offline).
 */
export type SpaceRoute =
	| { at: "here" }
	| { at: "host"; hostId: string; client: HostClient }
	| { at: "unreachable"; hostId: string };

export type SpaceRoutes = {
	/** Where a call for the Space goes now. It reads the Link at the moment of the call. */
	route(spaceId: string): Promise<SpaceRoute>;
	/**
	 * The procedures of the Host that keeps the Space. Throws
	 * `HostUnreachableError` when that Host cannot be reached, and for a
	 * Space this Replica keeps: no Host takes an action for it.
	 */
	host(spaceId: string): Promise<HostClient>;
};

/**
 * The one place the relays decide where a call for a Space goes, and the
 * only reader of `Link.client()`. It keeps no state: the Host of a Space
 * and the state of a Link can change between two calls.
 */
export function createSpaceRoutes(deps: {
	/** The Host that keeps the Space, or null for one this Replica keeps. */
	hostOf(spaceId: string): Promise<string | null>;
	/** Lazy: the links are made after the relay. */
	links(): Pick<DeviceLinks, "get">;
}): SpaceRoutes {
	async function route(spaceId: string): Promise<SpaceRoute> {
		const hostId = await deps.hostOf(spaceId);
		if (hostId === null) return { at: "here" };
		const client = deps.links().get(hostId)?.client();
		return client
			? { at: "host", hostId, client }
			: { at: "unreachable", hostId };
	}

	return {
		route,
		async host(spaceId) {
			const to = await route(spaceId);
			if (to.at !== "host") throw new HostUnreachableError();
			return to.client;
		},
	};
}
