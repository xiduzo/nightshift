import {
	HocuspocusProvider,
	HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import { HostUnreachableError } from "@nightshift/engine";
import { ORPCError } from "@orpc/client";
import type * as Y from "yjs";
import type { HostClient, HostHello } from "../contract";
import { pinnedWebSocket } from "../reach";
import { type Backoff, backoff, pause } from "./backoff";
import { hostClient } from "./host-client";
import type { HostLink } from "./host-links";
import type { LinkStatus } from "./types";

/**
 * The `Link` port: a Device's outbound connection to one Host. The Host
 * never calls into a Device; everything goes out from the Device over its
 * link. `httpsLink` is the one adapter: oRPC with the Device key, and the
 * Hocuspocus WebSocket to the same origin. (A peer-to-peer adapter, iroh,
 * comes later: see docs/research/devices.md, "Connectivity".)
 *
 * - It tries the Host's addresses in order and keeps the first that
 *   answers: the LAN name at home, the tailnet name in the tailnet, the
 *   public name elsewhere.
 * - A heartbeat every `heartbeatMs` keeps the Device online on the Host. A
 *   heartbeat that fails starts over at the first address, after a backoff
 *   that doubles up to `maxBackoffMs`.
 * - A Host that refuses the key (its owner removed this computer's
 *   access) ends the link for good: `revoked`.
 * - Over a link to its home Host, this Device's own document syncs, and a
 *   read-only copy of each of its owner's other Devices' documents that
 *   the Host lists. A copy the Host stops listing stops syncing.
 * - Over any link, the Space documents the Host lists (the Spaces this
 *   Device's owner is a Member of there) sync read-only.
 * - Every document goes over one WebSocket per link.
 *
 * The link owns the life of every call over it. A long call (the exchange
 * of run history, the work of placed steps) is a named `stream`: it runs
 * while the link is online, and the link starts it again after a drop or
 * a failure, with a backoff of its own. A call that fails because the
 * Host no longer knows the key makes the link ask the Host now.
 */
export type Link = {
	readonly hostId: string;
	state(): LinkState;
	/** The Host's procedures at the address that answers, with the key. Null while offline. */
	client(): HostClient | null;
	/**
	 * Keeps `open` running while the link is online. It starts when the
	 * link is online, and its signal aborts when the link drops or closes.
	 * It starts again when the link is back, and when it ends: at once
	 * when it returns after a heartbeat or more, else after the stream's
	 * backoff, which doubles while it keeps failing. A failure the Host
	 * gives because it no longer knows the key makes the link ask the Host
	 * now. `name` names it in the logs. Returns how to stop it.
	 */
	stream(
		name: string,
		open: (client: HostClient, signal: AbortSignal) => Promise<void>,
	): () => void;
	/** One call on the Host. Rejects at once with `HostUnreachableError` while the link is offline. */
	call<T>(use: (client: HostClient) => Promise<T>): Promise<T>;
	/**
	 * The Host's procedures as soon as the link is online. Rejects when
	 * `signal` aborts, or the link closes or is revoked.
	 */
	ready(signal?: AbortSignal): Promise<HostClient>;
	/** Asks the Host now instead of at the next heartbeat. */
	check(): void;
	/**
	 * Whether the document of this name syncs over the link and has
	 * taken the Host's state of it once.
	 */
	synced(name: string): boolean;
	/** Stops the link: no more calls, the document stops syncing, every stream stops. */
	close(): Promise<void>;
};

export type LinkState = {
	status: LinkStatus;
	/** The address that answers. Null while it looks for one. */
	address: string | null;
	/** Epoch ms of the last change of `status`. */
	since: number;
};

export type HttpsLinkOptions = {
	link: HostLink;
	key: string;
	/** This Device's document: it syncs over a link to the home Host. */
	document?: { name: string; doc: Y.Doc };
	/**
	 * The Space documents to sync from this Host, read-only: called with
	 * every answer of the Host, so a Space it lists later syncs too.
	 */
	spaceDocuments?(hello: HostHello): Promise<{ name: string; doc: Y.Doc }[]>;
	/**
	 * The copies of the owner's other Devices' documents, over a link to
	 * the home Host: called with every answer of the Host, so a Device it
	 * lists later syncs too, and one it no longer lists stops.
	 */
	deviceDocuments?(hello: HostHello): Promise<{ name: string; doc: Y.Doc }[]>;
	heartbeatMs?: number;
	firstBackoffMs?: number;
	maxBackoffMs?: number;
	/** The waits of a stream that fails. Default: 2 s, doubling up to 60 s. */
	streamBackoff?: { firstMs: number; maxMs: number };
	/** How long one address may take to answer. */
	answerTimeoutMs?: number;
	/** The Host listed its addresses: keep them for the next start. */
	onAddresses?(addresses: string[]): void;
	/** The Host refused the key. */
	onRevoked?(): void;
	onState?(state: LinkState): void;
	/** The Host at one address. Default: `hostClient` with the key and the pin. */
	clientFor?(address: string): HostClient;
	now?: () => number;
};

/** The first address whose call answers, in order. Throws the last error when none does. */
export async function firstAnswering<T>(
	addresses: readonly string[],
	call: (address: string) => Promise<T>,
): Promise<{ address: string; value: T }> {
	let last: unknown = new Error("The Host has no address.");
	for (const address of addresses) {
		try {
			return { address, value: await call(address) };
		} catch (error) {
			if (isRefusal(error)) throw error;
			last = error;
		}
	}
	throw last;
}

/** The Host answered, and refused the key. */
export function isRefusal(error: unknown): boolean {
	return (
		error instanceof ORPCError &&
		(error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN")
	);
}

/**
 * The Host does not know the key (its access was removed): the link asks
 * the Host at once instead of at the next heartbeat. A call the Host does
 * not allow (`FORBIDDEN`) is not this: the key is still good.
 */
function isUnknownKey(error: unknown): boolean {
	return error instanceof ORPCError && error.code === "UNAUTHORIZED";
}

/** A stream of the link: what it runs, and how long it waits after a failure. */
type Stream = {
	name: string;
	open(client: HostClient, signal: AbortSignal): Promise<void>;
	/** Aborts when the stream is stopped for good. */
	stopped: AbortController;
	waits: Backoff;
	/** The last failure it logged: a failure that repeats is said once. */
	logged: string | null;
};

export function httpsLink(options: HttpsLinkOptions): Link {
	const heartbeatMs = options.heartbeatMs ?? 15_000;
	const firstBackoffMs = options.firstBackoffMs ?? 1_000;
	const maxBackoffMs = options.maxBackoffMs ?? 60_000;
	const streamBackoff = options.streamBackoff ?? {
		firstMs: 2_000,
		maxMs: 60_000,
	};
	const answerTimeoutMs = options.answerTimeoutMs ?? 5_000;
	const now = options.now ?? Date.now;
	const { link, key } = options;
	const clientFor =
		options.clientFor ??
		((address: string) =>
			hostClient(address, { key, certificate: link.certificate }));

	let addresses = [...link.addresses];
	let state: LinkState = { status: "connecting", address: null, since: now() };
	let current: HostClient | null = null;
	let socket: HocuspocusProviderWebsocket | null = null;
	const providers = new Map<string, HocuspocusProvider>();
	/** The names of the copies of other Devices' documents that sync now. */
	const copies = new Set<string>();
	/** Aborts when the link drops: every stream stops. */
	let online: AbortController | null = null;
	const stop = new AbortController();
	const streams = new Set<Stream>();
	/** The callers of `ready` while the link is offline. */
	const waiting = new Set<{
		resolve(client: HostClient): void;
		reject(error: Error): void;
	}>();
	/** Cuts the wait for the next heartbeat short. */
	let nudge = new AbortController();
	/** Someone asked to check the Host while no wait was on. */
	let asked = false;

	function setState(status: LinkStatus, address: string | null) {
		if (state.status === status && state.address === address) return;
		state = { status, address, since: now() };
		options.onState?.(state);
	}

	function check() {
		asked = true;
		nudge.abort();
	}

	/** Waits `ms`, or less when the link closes or someone asks to check now. */
	async function wait(ms: number) {
		if (!asked) {
			nudge = new AbortController();
			await pause(ms, AbortSignal.any([stop.signal, nudge.signal]));
		}
		asked = false;
	}

	function learn(hello: HostHello, joinedBy: string) {
		const next = [...hello.host.addresses];
		// The address that answered stays, last, when the Host does not list it.
		if (!next.includes(joinedBy)) next.push(joinedBy);
		for (const address of addresses)
			if (!next.includes(address)) next.push(address);
		if (JSON.stringify(next) === JSON.stringify(addresses)) return;
		addresses = next;
		options.onAddresses?.(next);
	}

	/** The one WebSocket of this link to the Host's relay. */
	function socketTo(address: string): HocuspocusProviderWebsocket {
		if (socket) return socket;
		const url = new URL("/sync", address);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		// Bun's WebSocket does not fall back from `::1` to `127.0.0.1` as its
		// fetch does, and a daemon on this computer listens on `127.0.0.1`.
		if (url.hostname === "localhost") url.hostname = "127.0.0.1";
		socket = new HocuspocusProviderWebsocket({
			url: url.toString(),
			WebSocketPolyfill: pinnedWebSocket(link.certificate),
		});
		return socket;
	}

	function attach(address: string, name: string, doc: Y.Doc) {
		if (providers.has(name)) return;
		const provider = new HocuspocusProvider({
			websocketProvider: socketTo(address),
			name,
			document: doc,
			token: key,
			// The Host closed the socket (its owner may have removed this
			// computer's access): ask now instead of at the next heartbeat.
			onClose: check,
		});
		provider.attach();
		providers.set(name, provider);
	}

	async function syncDocuments(address: string, hello: HostHello) {
		if (link.role === "home" && options.document) {
			attach(address, options.document.name, options.document.doc);
		}
		for (const document of (await options.spaceDocuments?.(hello)) ?? []) {
			attach(address, document.name, document.doc);
		}
		if (link.role === "home" && options.deviceDocuments) {
			const listed = await options.deviceDocuments(hello);
			const names = new Set(listed.map((document) => document.name));
			for (const name of copies) {
				if (names.has(name)) continue;
				providers.get(name)?.destroy();
				providers.delete(name);
				copies.delete(name);
			}
			for (const document of listed) {
				attach(address, document.name, document.doc);
				copies.add(document.name);
			}
		}
	}

	function stopDocuments() {
		for (const provider of providers.values()) provider.destroy();
		providers.clear();
		copies.clear();
		socket?.destroy();
		socket = null;
	}

	/**
	 * Runs one stream while this online period lasts. A stream that ran
	 * for a heartbeat or more was well: its backoff starts over.
	 */
	async function keep(stream: Stream, client: HostClient, period: AbortSignal) {
		const signal = AbortSignal.any([period, stream.stopped.signal]);
		stream.waits.reset();
		while (!signal.aborted) {
			const started = now();
			let failure: unknown = null;
			try {
				await stream.open(client, signal);
			} catch (error) {
				failure = error ?? new Error("The stream failed.");
			}
			if (signal.aborted) return;
			const well = now() - started >= heartbeatMs;
			if (well) {
				stream.waits.reset();
				stream.logged = null;
			}
			if (failure === null) {
				if (well) continue;
			} else {
				if (isUnknownKey(failure)) check();
				const said = String(failure);
				if (stream.logged !== said) {
					stream.logged = said;
					console.error(
						`${stream.name} with ${link.name} stopped, it starts again:`,
						failure,
					);
				}
			}
			await pause(stream.waits.next(), signal);
		}
	}

	function goOnline(client: HostClient) {
		online = new AbortController();
		for (const stream of streams) void keep(stream, client, online.signal);
		for (const waiter of waiting) waiter.resolve(client);
		waiting.clear();
	}

	function goOffline() {
		online?.abort();
		online = null;
	}

	/** Ends the waits for `ready`: the link closed or was revoked. */
	function endWaits(reason: string) {
		for (const waiter of waiting) waiter.reject(new Error(reason));
		waiting.clear();
	}

	async function answer(address: string): Promise<HostHello> {
		const client = clientFor(address);
		const hello = await client.link.hello(undefined, {
			signal: AbortSignal.any([
				stop.signal,
				AbortSignal.timeout(answerTimeoutMs),
			]),
		});
		current = client;
		return hello;
	}

	async function run() {
		const waits = backoff({ firstMs: firstBackoffMs, maxMs: maxBackoffMs });
		while (!stop.signal.aborted) {
			try {
				const { address, value } = await firstAnswering(addresses, answer);
				learn(value, address);
				setState("online", address);
				waits.reset();
				await syncDocuments(address, value);
				goOnline(current as HostClient);
				while (!stop.signal.aborted) {
					await wait(heartbeatMs);
					if (stop.signal.aborted) break;
					const hello = await (current as HostClient).link.heartbeat(
						undefined,
						{
							signal: AbortSignal.any([
								stop.signal,
								AbortSignal.timeout(answerTimeoutMs),
							]),
						},
					);
					learn(hello, address);
					await syncDocuments(address, hello);
				}
			} catch (error) {
				current = null;
				goOffline();
				stopDocuments();
				if (stop.signal.aborted) break;
				if (isRefusal(error)) {
					setState("revoked", null);
					endWaits(`${link.name} no longer knows this computer.`);
					options.onRevoked?.();
					return;
				}
				setState("offline", null);
				await wait(waits.next());
			}
		}
	}

	const running = run().catch((error) => {
		console.error(`The link to ${link.name} stopped:`, error);
	});

	return {
		hostId: link.hostId,
		state: () => state,
		client: () => current,
		stream(name, open) {
			const stream: Stream = {
				name,
				open,
				stopped: new AbortController(),
				waits: backoff(streamBackoff),
				logged: null,
			};
			streams.add(stream);
			if (online && current) void keep(stream, current, online.signal);
			return () => {
				stream.stopped.abort();
				streams.delete(stream);
			};
		},
		async call(use) {
			const client = current;
			if (!client) throw new HostUnreachableError();
			try {
				return await use(client);
			} catch (error) {
				if (isUnknownKey(error)) check();
				throw error;
			}
		},
		ready(signal) {
			if (current && online) return Promise.resolve(current);
			if (stop.signal.aborted || state.status === "revoked") {
				return Promise.reject(new Error(`The link to ${link.name} is closed.`));
			}
			return new Promise((resolve, reject) => {
				const waiter = {
					resolve(client: HostClient) {
						signal?.removeEventListener("abort", aborted);
						resolve(client);
					},
					reject(error: Error) {
						signal?.removeEventListener("abort", aborted);
						reject(error);
					},
				};
				function aborted() {
					waiting.delete(waiter);
					reject(signal?.reason ?? new Error("The wait was stopped."));
				}
				if (signal?.aborted) return aborted();
				signal?.addEventListener("abort", aborted, { once: true });
				waiting.add(waiter);
			});
		},
		check,
		synced: (name) => providers.get(name)?.isSynced === true,
		async close() {
			stop.abort();
			goOffline();
			stopDocuments();
			current = null;
			for (const stream of streams) stream.stopped.abort();
			streams.clear();
			endWaits(`The link to ${link.name} is closed.`);
			await running;
		},
	};
}
