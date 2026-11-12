import { HostUnreachableError } from "@nightshift/engine";
import type { HostClient, HostHello } from "../contract";
import type { CallOptions, DeviceLinks } from "../links";

/**
 * Where a call for a Space goes now:
 * - `here`: this Replica keeps the Space (it is that Space's Host).
 * - `host`: a Host keeps it, and its Link is online. `client` calls that
 *   Host with this Device's key. `ask` makes one call for a person.
 * - `unreachable`: a Host keeps it, and this computer has no online Link
 *   to it now (no Link, or the Link is offline).
 *
 * The Host's answers come in this computer's words: the Link's
 * (`Link.client`, `Link.call`).
 */
export type SpaceRoute =
	| { at: "here" }
	| {
			at: "host";
			hostId: string;
			client: HostClient;
			/** What the Host said of itself last (`Link.hello`). Null: it did not say yet. */
			hello: HostHello | null;
			/** One call on the Host for a person: `Link.call`, with its deadline (`CallOptions`). */
			ask<T>(
				use: (client: HostClient, signal: AbortSignal) => Promise<T>,
				options?: CallOptions,
			): Promise<T>;
	  }
	| { at: "unreachable"; hostId: string };

export type SpaceRoutes = {
	/** Where a call for the Space goes now. It reads the Link at the moment of the call. */
	route(spaceId: string): Promise<SpaceRoute>;
	/**
	 * One call for a person on the Host that keeps the Space. Throws
	 * `HostUnreachableError` when that Host cannot be reached, and for a
	 * Space this Replica keeps: no Host takes an action for it.
	 */
	onHost<T>(
		spaceId: string,
		use: (client: HostClient, signal: AbortSignal) => Promise<T>,
		options?: CallOptions,
	): Promise<T>;
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
		const link = deps.links().get(hostId);
		const client = link?.client();
		if (!link || !client) return { at: "unreachable", hostId };
		return {
			at: "host",
			hostId,
			client,
			hello: link.hello(),
			ask: (use, options) => link.call(use, options),
		};
	}

	return {
		route,
		async onHost(spaceId, use, options) {
			const to = await route(spaceId);
			if (to.at !== "host") throw new HostUnreachableError();
			return to.ask(use, options);
		},
	};
}
