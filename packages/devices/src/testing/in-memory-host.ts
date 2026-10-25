import type { DeviceKeyAccess } from "@nightshift/auth";
import { createRouterClient, ORPCError } from "@orpc/server";
import { type HostClient, type HostHello, hostContract } from "../contract";
import type { HostExchange } from "../exchange";
import { type HostPeerContext, hostRouter } from "../host";

/**
 * A Host in this process: the Host's own router (`hostRouter`), called
 * through oRPC's router client instead of HTTPS. It is `HostClient`'s
 * second adapter, beside the HTTPS client (`links/host-client.ts`), and
 * it runs the code the API serves: the key rules, the input schemas with
 * their defaults and transforms, and the error mapping.
 *
 * What it adds is the transport, as a Device sees it:
 *
 * - Values are copies, both ways, so two Replicas never share an object.
 * - A plain Error inside a stream is an INTERNAL_SERVER_ERROR, as the RPC
 *   handler sends it.
 * - `down()` is the network gone: every call rejects with a TypeError, as
 *   a fetch does, and every open stream ends with one. `up()` brings it
 *   back.
 *
 * Pairing is not served here, and the Host keeps no phones.
 */
export type MemoryHost = {
	/**
	 * The Host's procedures as the Device with this key calls them. A
	 * function is read on every call: it returns null for a key the Host
	 * no longer knows.
	 */
	client(key: KeyOf): HostClient;
	/** For `httpsLink({ clientFor })`: every address reaches this Host. */
	clientFor(key: KeyOf): (address: string) => HostClient;
	/** The network drops: calls reject, open streams end with an error. */
	down(): void;
	/** The network is back. */
	up(): void;
};

type KeyOf = DeviceKeyAccess | (() => DeviceKeyAccess | null);

/** What a call gets besides its input, as the oRPC client takes it. */
type CallOptions = { signal?: AbortSignal };

/** One procedure of the router client, as this adapter calls it. */
type Procedure = (input: unknown, options?: CallOptions) => Promise<unknown>;

export function inMemoryHost(deps: {
	exchange: HostExchange;
	/** `link.hello` and `link.heartbeat`: the Host's answer for the key (`Host.hello`). */
	hello(key: DeviceKeyAccess): Promise<HostHello>;
}): MemoryHost {
	let network = new AbortController();

	/** Throws as a fetch does while the network is down. */
	function reachable(): AbortSignal {
		if (network.signal.aborted) throw lost();
		return network.signal;
	}

	function client(keyOf: KeyOf): HostClient {
		const read = typeof keyOf === "function" ? keyOf : () => keyOf;
		const router = createRouterClient(hostRouter, {
			context: (): HostPeerContext => ({
				deviceKey: read(),
				exchange: deps.exchange,
				devices: {
					hello: deps.hello,
					startPairing: notServed,
					redeemPairing: notServed,
				},
				phones: {
					list: async () => [],
					remove: async () => {
						throw new ORPCError("NOT_FOUND", {
							message: "This Host keeps no phones.",
						});
					},
				},
			}),
		});

		/** One procedure over the network: copies of its values, lost when the network drops. */
		function overNetwork(procedure: Procedure): Procedure {
			return async (input, options) => {
				const gone = reachable();
				const signal = AbortSignal.any(
					options?.signal ? [options.signal, gone] : [gone],
				);
				const answer = procedure(structuredClone(input), { signal }).then(
					(value) =>
						isStream(value)
							? relayed(value, signal, gone)
							: structuredClone(value),
				);
				// The answer of a call in flight when the network drops is lost.
				return Promise.race([answer, rejectOn(gone)]);
			};
		}

		// A plain object of the contract's procedures, so a test may replace one.
		const groups = router as unknown as Record<
			string,
			Record<string, Procedure>
		>;
		return Object.fromEntries(
			Object.entries(hostContract).map(([group, procedures]) => [
				group,
				Object.fromEntries(
					Object.keys(procedures).map((name) => {
						const procedure = groups[group]?.[name] as Procedure;
						return [name, overNetwork(procedure)];
					}),
				),
			]),
		) as unknown as HostClient;
	}

	return {
		client,
		clientFor: (key) => () => client(key),
		down() {
			network.abort();
		},
		up() {
			if (network.signal.aborted) network = new AbortController();
		},
	};
}

/** The card's shape, for a test with one Device: the Host's procedures for one key. */
export function inMemoryHostClient(
	exchange: HostExchange,
	key: KeyOf,
	hello: (key: DeviceKeyAccess) => Promise<HostHello> = () =>
		Promise.reject(new Error("This Host does not say hello in this test.")),
): HostClient {
	return inMemoryHost({ exchange, hello }).client(key);
}

async function notServed(): Promise<never> {
	throw new Error("Pairing is not served in memory.");
}

function isStream(value: unknown): value is AsyncIterable<unknown> {
	return (
		typeof value === "object" && value !== null && Symbol.asyncIterator in value
	);
}

/** The error a fetch throws when the network is gone. */
function lost(): TypeError {
	return new TypeError("The network connection was lost.");
}

/** Rejects when the network drops. */
function rejectOn(gone: AbortSignal): Promise<never> {
	return new Promise((_, reject) => {
		if (gone.aborted) return reject(lost());
		gone.addEventListener("abort", () => reject(lost()), { once: true });
	});
}

/**
 * The Host's stream as the Device reads it: copies of its values; the end
 * when the call's signal aborts; a TypeError when the network drops.
 */
async function* relayed<T>(
	source: AsyncIterable<T>,
	signal: AbortSignal,
	gone: AbortSignal,
): AsyncGenerator<T> {
	const iterator = source[Symbol.asyncIterator]();
	const stopped = new Promise<null>((resolve) => {
		if (signal.aborted) return resolve(null);
		signal.addEventListener("abort", () => resolve(null), { once: true });
	});
	try {
		while (true) {
			const next = await Promise.race([iterator.next(), stopped]).catch(
				(error: unknown) => {
					if (gone.aborted) throw lost();
					if (error instanceof ORPCError || !(error instanceof Error)) {
						throw error;
					}
					throw new ORPCError("INTERNAL_SERVER_ERROR", { cause: error });
				},
			);
			if (gone.aborted) throw lost();
			if (next === null || next.done) return;
			yield structuredClone(next.value);
		}
	} finally {
		// The Host's side ends with its signal; do not wait for it.
		void iterator.return?.()?.catch(() => {});
	}
}
