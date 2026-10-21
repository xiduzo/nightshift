import {
	HocuspocusProvider,
	HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import { ORPCError } from "@orpc/client";
import type * as Y from "yjs";
import type { HostClient, HostHello } from "../contract";
import { pinnedWebSocket } from "../reach";
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
 * - Over a link to its home Host, this Device's own document syncs.
 * - Over any link, the Space documents the Host lists (the Spaces this
 *   Device's owner is a Member of there) sync read-only, and `whileOnline`
 *   runs (the exchange of run history), stopped when the link drops.
 * - Every document goes over one WebSocket per link.
 */
export type Link = {
	readonly hostId: string;
	state(): LinkState;
	/** The Host's procedures at the address that answers, with the key. Null while offline. */
	client(): HostClient | null;
	/** Stops the link: no more calls, the document stops syncing. */
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
	/** Runs while the link is online; `signal` aborts when it drops or closes. */
	whileOnline?(
		client: HostClient,
		hello: HostHello,
		signal: AbortSignal,
	): Promise<void>;
	heartbeatMs?: number;
	firstBackoffMs?: number;
	maxBackoffMs?: number;
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

export function httpsLink(options: HttpsLinkOptions): Link {
	const heartbeatMs = options.heartbeatMs ?? 15_000;
	const firstBackoffMs = options.firstBackoffMs ?? 1_000;
	const maxBackoffMs = options.maxBackoffMs ?? 60_000;
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
	let online: AbortController | null = null;
	const stop = new AbortController();
	/** Cuts the wait for the next heartbeat short. */
	let nudge = new AbortController();

	function setState(status: LinkStatus, address: string | null) {
		if (state.status === status && state.address === address) return;
		state = { status, address, since: now() };
		options.onState?.(state);
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
			onClose: () => nudge.abort(),
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
	}

	function stopDocuments() {
		for (const provider of providers.values()) provider.destroy();
		providers.clear();
		socket?.destroy();
		socket = null;
	}

	function goOnline(client: HostClient, hello: HostHello) {
		online = new AbortController();
		const signal = online.signal;
		options.whileOnline?.(client, hello, signal).catch((error) => {
			if (!signal.aborted) {
				console.error(`The exchange with ${link.name} stopped:`, error);
			}
		});
	}

	function goOffline() {
		online?.abort();
		online = null;
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
		let failures = 0;
		while (!stop.signal.aborted) {
			try {
				const { address, value } = await firstAnswering(addresses, answer);
				learn(value, address);
				setState("online", address);
				failures = 0;
				await syncDocuments(address, value);
				goOnline(current as HostClient, value);
				while (!stop.signal.aborted) {
					nudge = new AbortController();
					await sleep(
						heartbeatMs,
						AbortSignal.any([stop.signal, nudge.signal]),
					);
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
					options.onRevoked?.();
					return;
				}
				setState("offline", null);
				failures++;
				await sleep(
					Math.min(maxBackoffMs, firstBackoffMs * 2 ** (failures - 1)),
					stop.signal,
				);
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
		async close() {
			stop.abort();
			goOffline();
			stopDocuments();
			current = null;
			await running;
		},
	};
}

/** Resolves after `ms`, or at once when the signal aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve();
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		}
		signal.addEventListener("abort", done, { once: true });
	});
}
