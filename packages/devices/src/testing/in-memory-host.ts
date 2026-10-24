import type { DeviceKeyAccess, DeviceKeyPermission } from "@nightshift/auth";
import { HostUnreachableError } from "@nightshift/engine";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import {
	archiveRefSchema,
	copyStampSchema,
	feedStepSchema,
	type HostClient,
	type HostHello,
	offerCapsSchema,
	type RunRows,
	runRowsSchema,
	type SyncCursors,
	syncCursorsSchema,
	transcriptEntrySchema,
	workReplySchema,
	workRequestSchema,
} from "../contract";
import type { HostExchange } from "../exchange";

/**
 * A Host in this process: its `HostExchange` behind the `HostClient` a
 * Device calls. It is `HostClient`'s second adapter, beside the oRPC
 * client of the API's router (`links/host-client.ts`). It keeps the
 * router's rules that the Device sees:
 *
 * - The key: none is UNAUTHORIZED, one without the procedure's group is
 *   FORBIDDEN (`link.*` and `sync.*` need `sync`, `archive.*` needs
 *   `archive`, `devices.*` needs `relay`).
 * - Errors: an ORPCError passes on as it is. A plain Error of a call is
 *   a BAD_REQUEST with its message, a `HostUnreachableError` is a
 *   HOST_UNREACHABLE (the API's `readable`, procedures.ts).
 *   A plain Error inside a stream is an INTERNAL_SERVER_ERROR, as oRPC
 *   sends it.
 * - Values: inputs are checked with the wire schemas the router uses from
 *   `contract/`. Inputs and outputs are copies, so two Replicas never
 *   share an object.
 *
 * `down()` is the network gone: every call rejects with a TypeError, as a
 * fetch does, and every open stream ends with one. `up()` brings it back.
 * Pairing is not served here.
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

/** The input of one of the Host's procedures. */
type Input<
	G extends keyof HostClient,
	P extends keyof HostClient[G],
> = HostClient[G][P] extends (input: infer I, ...rest: never[]) => unknown
	? Exclude<I, undefined>
	: never;

/** `sync.stream`'s input, as the router checks it. */
const syncCursorsInput = z.object({ cursors: syncCursorsSchema });

export function inMemoryHost(deps: {
	exchange: HostExchange;
	/** `link.hello` and `link.heartbeat`: the Host's answer for the key. */
	hello(key: DeviceKeyAccess): Promise<HostHello>;
}): MemoryHost {
	const { exchange } = deps;
	let network = new AbortController();

	/** Throws as a fetch does while the network is down. */
	function reachable(): AbortSignal {
		if (network.signal.aborted) throw lost();
		return network.signal;
	}

	function client(keyOf: KeyOf): HostClient {
		const read = typeof keyOf === "function" ? keyOf : () => keyOf;

		/** The key, if it allows the group: the API's `deviceProcedure`. */
		function admit(need: DeviceKeyPermission): DeviceKeyAccess {
			const key = read();
			if (!key) {
				throw new ORPCError("UNAUTHORIZED", {
					message: "This device has no access here. Pair it again.",
				});
			}
			if (!key.permissions[need]?.length) {
				throw new ORPCError("FORBIDDEN", {
					message: "This device may not do this here.",
				});
			}
			return key;
		}

		/** One procedure that answers once. */
		function unary<I, O>(
			need: DeviceKeyPermission,
			handle: (key: DeviceKeyAccess, input: I) => Promise<O>,
			schema?: z.ZodType,
		) {
			return async (input: I, _options?: CallOptions): Promise<O> => {
				const gone = reachable();
				const key = admit(need);
				schema?.parse(input);
				const answer = handle(key, structuredClone(input)).then(
					(value) => structuredClone(value),
					(error: unknown) => {
						throw readable(error);
					},
				);
				// The answer of a call in flight when the network drops is lost.
				return Promise.race([answer, rejectOn(gone)]);
			};
		}

		/** One procedure that streams: its values until it ends, or the call's signal aborts. */
		function streaming<I, O>(
			need: DeviceKeyPermission,
			open: (
				key: DeviceKeyAccess,
				input: I,
				signal: AbortSignal,
			) => AsyncIterable<O>,
			schema?: z.ZodType,
		) {
			return async (
				input: I,
				options?: CallOptions,
			): Promise<AsyncIterable<O>> => {
				const gone = reachable();
				const key = admit(need);
				schema?.parse(input);
				const signal = AbortSignal.any(
					options?.signal ? [options.signal, gone] : [gone],
				);
				return relayed(open(key, structuredClone(input), signal), signal, gone);
			};
		}

		return {
			link: {
				hello: unary("sync", (key) => deps.hello(key)),
				heartbeat: unary("sync", (key) => deps.hello(key)),
				// Phones sign in to a real Host: this one keeps none.
				phones: unary("sync", async () => []),
				removePhone: async () => {
					throw new Error("This Host keeps no phones.");
				},
			},
			pairing: {
				start: notServed,
				redeem: notServed,
			},
			sync: {
				stream: streaming(
					"sync",
					(key, input: { cursors: SyncCursors }, signal) =>
						exchange.stream(key, input.cursors, signal),
					syncCursorsInput,
				),
				push: unary(
					"sync",
					(key, input: RunRows) => exchange.push(key, input),
					runRowsSchema,
				),
				command: unary("sync", (key, input: Input<"sync", "command">) =>
					exchange.command(key, input),
				),
				commandDone: unary("sync", (key, input: Input<"sync", "commandDone">) =>
					exchange.commandDone(key, input),
				),
				startRun: unary("sync", (key, input: Input<"sync", "startRun">) =>
					exchange.startRun(key, input),
				),
				devices: unary("sync", (key, input: Input<"sync", "devices">) =>
					exchange.devices(key, input),
				),
				offer: unary(
					"sync",
					(key, input: Input<"sync", "offer">) => exchange.offer(key, input),
					offerCapsSchema,
				),
				withdrawOffer: unary(
					"sync",
					(key, input: Input<"sync", "withdrawOffer">) =>
						exchange.withdrawOffer(key, input),
				),
				addClone: unary("sync", (key, input: Input<"sync", "addClone">) =>
					exchange.addClone(key, input),
				),
			},
			archive: {
				put: unary("archive", (key, input: Input<"archive", "put">) => {
					archiveRefSchema.parse(input.ref);
					const stamp = input.stamp && copyStampSchema.parse(input.stamp);
					return exchange.archivePut(key, input.ref, input.content, stamp);
				}),
				get: unary("archive", (key, input: Input<"archive", "get">) => {
					archiveRefSchema.parse(input.ref);
					return exchange.archiveGet(key, input.ref);
				}),
				follow: streaming(
					"archive",
					(key, input: Input<"archive", "follow">, signal) => {
						feedStepSchema.parse(input.step);
						return exchange.archiveFollow(key, input, signal);
					},
				),
				tail: unary(
					"archive",
					(key, input: Parameters<HostClient["archive"]["tail"]>[0]) => {
						feedStepSchema.parse(input.step);
						for (const entry of input.entries)
							transcriptEntrySchema.parse(entry);
						return exchange.archiveTail(key, input);
					},
				),
			},
			devices: {
				work: streaming(
					"relay",
					(key, input: Input<"devices", "work">, signal) =>
						exchange.work(key, input, signal),
				),
				call: streaming(
					"relay",
					(key, input: Input<"devices", "call">, signal) => {
						workRequestSchema.parse(input.request);
						return exchange.call(key, input, signal);
					},
				),
				reachable: unary("relay", (key, input: Input<"devices", "reachable">) =>
					exchange.reachable(key, input.deviceId),
				),
				workReply: unary(
					"relay",
					(key, input: Input<"devices", "workReply">) => {
						for (const reply of input.replies) workReplySchema.parse(reply);
						return exchange.workReply(key, input);
					},
				),
			},
		};
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

/** A plain error written for people, as the API's `readable` passes it on. */
function readable(error: unknown): unknown {
	if (error instanceof ORPCError || !(error instanceof Error)) return error;
	if (error instanceof HostUnreachableError) {
		return new ORPCError("HOST_UNREACHABLE", {
			status: 503,
			message: error.message,
			cause: error,
		});
	}
	return new ORPCError("BAD_REQUEST", { message: error.message, cause: error });
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
