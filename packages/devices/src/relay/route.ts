import { HostUnreachableError } from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import type { HostClient } from "../contract";
import { type DeviceLinks, fromHost } from "../links";

/**
 * Where a call for a Space goes now:
 * - `here`: this Replica keeps the Space (it is that Space's Host).
 * - `host`: a Host keeps it, and its Link is online. `client` calls that
 *   Host with this Device's key. `ask` makes one call for a person.
 * - `unreachable`: a Host keeps it, and this computer has no online Link
 *   to it now (no Link, or the Link is offline).
 */
export type SpaceRoute =
	| { at: "here" }
	| {
			at: "host";
			hostId: string;
			client: HostClient;
			/**
			 * One call on the Host for a person: the Host's errors in this
			 * computer's words (`fromHost`). It gives up after its deadline
			 * (`AskOptions`), and `use` may pass the signal to the call.
			 */
			ask<T>(
				use: (client: HostClient, signal: AbortSignal) => Promise<T>,
				options?: AskOptions,
			): Promise<T>;
	  }
	| { at: "unreachable"; hostId: string };

/** How long one call on the Host may take before it settles, and the words when it does not. */
export type AskOptions = { ms?: number; words?: string };

/**
 * How long a call on the Host may take by default. A call that opens a
 * stream settles when the stream opens, so the stream itself has no limit.
 */
export const ASK_DEADLINE_MS = 2 * 60_000;

/** A call on the Host that did not settle in time. */
export const HOST_TOO_SLOW =
	"The computer that keeps this Space did not answer in time. Try again in a moment.";

export type SpaceRoutes = {
	/** Where a call for the Space goes now. It reads the Link at the moment of the call. */
	route(spaceId: string): Promise<SpaceRoute>;
	/**
	 * One call for a person on the Host that keeps the Space. Throws
	 * `HostUnreachableError` when that Host cannot be reached, and for a
	 * Space this Replica keeps: no Host takes an action for it. The Host's
	 * errors come back in this computer's words (`fromHost`).
	 */
	onHost<T>(
		spaceId: string,
		use: (client: HostClient, signal: AbortSignal) => Promise<T>,
		options?: AskOptions,
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
		const client = deps.links().get(hostId)?.client();
		if (!client) return { at: "unreachable", hostId };
		return {
			at: "host",
			hostId,
			client,
			async ask(use, options = {}) {
				// Aborted only when the deadline passes first: a stream that
				// opened in time runs on.
				const late = new AbortController();
				let timer: Timer | undefined;
				const deadline = new Promise<never>((_, reject) => {
					timer = setTimeout(() => {
						// The refusal first: the aborted call then rejects too, but too late to win the race.
						reject(new Refusal("unavailable", options.words ?? HOST_TOO_SLOW));
						late.abort();
					}, options.ms ?? ASK_DEADLINE_MS);
					timer.unref?.();
				});
				try {
					return await Promise.race([use(client, late.signal), deadline]);
				} catch (error) {
					throw fromHost(error);
				} finally {
					clearTimeout(timer);
				}
			},
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
