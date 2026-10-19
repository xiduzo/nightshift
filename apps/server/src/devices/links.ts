import type { HostHello, LinkedHost } from "@nightshift/api/context";
import type { AppRouterClient } from "@nightshift/api/routers/index";
import type { DeviceKeyStore, HostLink, HostLinks } from "@nightshift/engine";
import type * as Y from "yjs";

import { type HttpsLinkOptions, httpsLink, type Link } from "./link";

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
	/** Runs while a link is online: the exchange of run history with its Host. */
	whileOnline?(
		link: HostLink,
		client: AppRouterClient,
		hello: HostHello,
		signal: AbortSignal,
	): Promise<void>;
	/** For tests: shorter heartbeats and backoffs. */
	linkOptions?: Pick<
		HttpsLinkOptions,
		"heartbeatMs" | "firstBackoffMs" | "maxBackoffMs" | "answerTimeoutMs"
	>;
}): DeviceLinks {
	const running = new Map<string, Link>();

	async function add(link: HostLink, key?: string) {
		await running.get(link.hostId)?.close();
		running.delete(link.hostId);
		if (link.revokedAt) return;
		const secret = key ?? (await deps.keys.get(link.hostId));
		if (!secret) {
			console.error(
				`No key for ${link.name} on this computer: pair with it again.`,
			);
			return;
		}
		running.set(
			link.hostId,
			httpsLink({
				...deps.linkOptions,
				link,
				key: secret,
				document: deps.document,
				...(deps.spaceDocuments
					? {
							spaceDocuments: (hello: HostHello) =>
								deps.spaceDocuments?.(link, hello) ?? Promise.resolve([]),
						}
					: {}),
				...(deps.whileOnline
					? {
							whileOnline: (
								client: AppRouterClient,
								hello: HostHello,
								signal: AbortSignal,
							) =>
								deps.whileOnline?.(link, client, hello, signal) ??
								Promise.resolve(),
						}
					: {}),
				onAddresses: (addresses) => {
					deps.links.setAddresses(link.hostId, addresses).catch(() => {});
				},
				onRevoked: () => {
					void deps.links
						.revoked(link.hostId)
						.then(() => deps.keys.delete(link.hostId))
						.catch(() => {});
				},
			}),
		);
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
			await Promise.all([...running.values()].map((link) => link.close()));
			running.clear();
		},
	};
}
