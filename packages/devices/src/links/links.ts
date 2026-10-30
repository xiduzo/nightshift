import type * as Y from "yjs";
import type { HostClient, HostHello } from "../contract";
import {
	type DeviceKeyStore,
	type HostLink,
	type HostLinks,
	isHomeHost,
} from "./host-links";
import { type HttpsLinkOptions, httpsLink, type Link } from "./link";
import type { LinkedHost } from "./types";

/**
 * This computer's running links, one per Host it paired with: started for
 * every link with access when the daemon starts, and for a new one when a
 * pairing ends. A Host that refuses the key marks its link revoked, and
 * the key is deleted.
 */
export type DeviceLinks = {
	/** Starts the links of the Replica. */
	start(): Promise<void>;
	/** Starts (or restarts) the link to one Host. */
	add(link: HostLink, key?: string): Promise<void>;
	/** Every Host this computer paired with, and how its link is now. */
	hosts(): Promise<LinkedHost[]>;
	/** The running link to a Host, if any. */
	get(hostId: string): Link | undefined;
	close(): Promise<void>;
};

/** The options of each Link that a test may set (`httpsLink`). */
export type LinkOptions = Pick<
	HttpsLinkOptions,
	| "heartbeatMs"
	| "firstBackoffMs"
	| "maxBackoffMs"
	| "answerTimeoutMs"
	| "streamBackoff"
>;

export function createDeviceLinks(deps: {
	links: HostLinks;
	keys: DeviceKeyStore;
	/** This Device's document: it syncs with the home Host. */
	document: { name: string; doc: Y.Doc };
	/** The Space documents to sync from a Host, read-only (the Spaces it lists). */
	spaceDocuments?(
		link: HostLink,
		hello: HostHello,
	): Promise<{ name: string; doc: Y.Doc }[]>;
	/**
	 * The copies of the owner's other Devices' documents to sync from the
	 * home Host, read-only (the Devices it lists).
	 */
	deviceDocuments?(
		link: HostLink,
		hello: HostHello,
	): Promise<{ name: string; doc: Y.Doc }[]>;
	/** The Host refused the key: this computer's access there was removed. */
	revoked?(link: HostLink): Promise<void>;
	/**
	 * Called once for each link it starts: what runs over it (the exchange
	 * of run history, the work of placed steps), as the link's streams.
	 * The function it returns is called when the link stops.
	 */
	attach?(hostLink: HostLink, link: Link): () => void;
	/**
	 * The Host at an address, as a link calls it. Default: over HTTPS,
	 * with the link's key and its pinned certificate (`hostClient`).
	 */
	hostClient?(address: string): HostClient;
	/** For tests: shorter heartbeats and backoffs. */
	linkOptions?: LinkOptions;
}): DeviceLinks {
	const running = new Map<string, Link>();
	/** Per running link: how to stop what was attached to it. */
	const detach = new Map<string, () => void>();

	async function stop(hostId: string) {
		detach.get(hostId)?.();
		detach.delete(hostId);
		await running.get(hostId)?.close();
		running.delete(hostId);
	}

	async function add(link: HostLink, key?: string) {
		await stop(link.hostId);
		if (link.revokedAt) return;
		const secret = key ?? (await deps.keys.get(link.hostId));
		if (!secret) {
			console.error(
				`This computer has no key for ${link.name}. Pair with it again.`,
			);
			return;
		}
		const started = httpsLink({
			...deps.linkOptions,
			...(deps.hostClient ? { clientFor: deps.hostClient } : {}),
			link,
			key: secret,
			document: deps.document,
			...(deps.spaceDocuments
				? {
						spaceDocuments: (hello: HostHello) =>
							deps.spaceDocuments?.(link, hello) ?? Promise.resolve([]),
					}
				: {}),
			...(deps.deviceDocuments
				? {
						deviceDocuments: (hello: HostHello) =>
							deps.deviceDocuments?.(link, hello) ?? Promise.resolve([]),
					}
				: {}),
			onAddresses: (addresses) => {
				deps.links.setAddresses(link.hostId, addresses).catch(() => {});
			},
			onRevoked: () => {
				void deps.links
					.revoked(link.hostId)
					.then(() => deps.keys.delete(link.hostId))
					.then(() => deps.revoked?.(link))
					.catch(() => {});
			},
		});
		running.set(link.hostId, started);
		const attached = deps.attach?.(link, started);
		if (attached) detach.set(link.hostId, attached);
	}

	return {
		async start() {
			for (const link of await deps.links.list()) await add(link);
		},
		add,
		async hosts() {
			return (await deps.links.list()).map((link) => {
				const state = running.get(link.hostId)?.state();
				return {
					hostId: link.hostId,
					name: link.name,
					role: link.role,
					homeHost: isHomeHost(link),
					addresses: link.addresses,
					address: state?.address ?? null,
					status: link.revokedAt ? "revoked" : (state?.status ?? "offline"),
					since: state?.since ?? link.revokedAt ?? link.createdAt,
					fingerprint: link.fingerprint,
				};
			});
		},
		get: (hostId) => running.get(hostId),
		async close() {
			await Promise.all([...running.keys()].map(stop));
		},
	};
}
