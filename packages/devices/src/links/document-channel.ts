import {
	HocuspocusProvider,
	HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import type * as Y from "yjs";
import { pinnedWebSocket } from "../reach";

/** A document a link syncs: the name the Host knows it by, and this Replica's copy. */
export type SyncedDocument = { name: string; doc: Y.Doc };

/**
 * The document half of a Link: this Replica's documents in step with the
 * Host's, by name. Each document takes the Host's state, and the Host
 * takes its changes where the Host's access rules let it write; a
 * read-only document only receives. The Host serves its documents as
 * `ServedDocuments` says.
 *
 * Two adapters: Hocuspocus over one WebSocket to the Host's relay
 * (`hocuspocusChannel`), and the Host in memory of the tests
 * (`inMemoryHost`).
 */
export type DocumentChannel = {
	/** Syncs these documents from now on: a new name attaches, and a name it no longer gets detaches. */
	sync(documents: readonly SyncedDocument[]): void;
	/**
	 * Whether each of these documents syncs, has taken the Host's state
	 * once, and the Host has every change this Replica made to it.
	 */
	inStep(names: readonly string[]): boolean;
	/** Stops syncing every document. */
	close(): void;
};

/** How a link opens its document channel to the Host at an address that answered. */
export type OpenDocumentChannel = (to: {
	address: string;
	/** The Device key. */
	key: string;
	/** The Host's pinned certificate, if any. */
	certificate: string | null;
	/** The Host closed the channel: its owner may have removed this computer's access. */
	closed(): void;
}) => DocumentChannel;

/** The channel over Hocuspocus: one WebSocket to the Host's relay, made when the first document attaches. */
export const hocuspocusChannel: OpenDocumentChannel = (to) => {
	let socket: HocuspocusProviderWebsocket | null = null;
	const providers = new Map<string, HocuspocusProvider>();

	function socketTo(): HocuspocusProviderWebsocket {
		if (socket) return socket;
		const url = new URL("/sync", to.address);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		// Bun's WebSocket does not fall back from `::1` to `127.0.0.1` as its
		// fetch does, and a daemon on this computer listens on `127.0.0.1`.
		if (url.hostname === "localhost") url.hostname = "127.0.0.1";
		socket = new HocuspocusProviderWebsocket({
			url: url.toString(),
			WebSocketPolyfill: pinnedWebSocket(to.certificate),
		});
		return socket;
	}

	return {
		sync(documents) {
			const names = new Set(documents.map((document) => document.name));
			for (const [name, provider] of providers) {
				if (names.has(name)) continue;
				provider.destroy();
				providers.delete(name);
			}
			for (const { name, doc } of documents) {
				if (providers.has(name)) continue;
				const provider = new HocuspocusProvider({
					websocketProvider: socketTo(),
					name,
					document: doc,
					token: to.key,
					onClose: to.closed,
				});
				provider.attach();
				providers.set(name, provider);
			}
		},
		inStep(names) {
			return names.every((name) => {
				const provider = providers.get(name);
				return provider?.isSynced === true && !provider.hasUnsyncedChanges;
			});
		},
		close() {
			for (const provider of providers.values()) provider.destroy();
			providers.clear();
			socket?.destroy();
			socket = null;
		},
	};
};
