import * as Y from "yjs";
import type { ServedDocuments } from "../host";
import type { OpenDocumentChannel, SyncedDocument } from "../links";

type DocumentChannel = ReturnType<OpenDocumentChannel>;

/** The network between a Device and the Host in memory, as the channel reads it. */
export type MemoryNetwork = {
	up(): boolean;
	/** Called when the network drops or comes back. Returns how to stop listening. */
	watch(changed: () => void): () => void;
};

/** What the relay sees of a client in memory: another computer, with no session. */
const PEER = "memory";
const UPGRADE = "https://memory.invalid/sync";

/**
 * The document channel's second adapter, beside Hocuspocus: the Host's
 * relay in memory. It serves what the Host serves (`ServedDocuments`):
 * its own documents, the documents it keeps for others, and its access
 * rules for the key. It does what the relay does:
 *
 * - A document the rules refuse never syncs.
 * - A document takes the Host's state when it attaches, and from then on
 *   every update goes both ways. On a read-only connection the Host
 *   drops this Replica's updates, as Hocuspocus does, and the document
 *   is not in step while it has a change the Host does not.
 * - A kept document is loaded from its rows once, and stored after each
 *   change.
 * - While the network is down nothing syncs and nothing is in step. When
 *   it is back, each document syncs again from both sides' state.
 *
 * Updates arrive at once, in the same tick: a test does not wait for them.
 */
export function memoryDocuments(
	served: ServedDocuments,
	network: MemoryNetwork,
): OpenDocumentChannel {
	/** The Host's copy of each kept document it loaded. */
	const keptDocs = new Map<string, Promise<Y.Doc>>();

	function keptDoc(name: string, kept: NonNullable<ServedDocuments["kept"]>) {
		let loaded = keptDocs.get(name);
		if (!loaded) {
			loaded = (async () => {
				const doc = new Y.Doc();
				const state = await kept.fetch(name);
				if (state) Y.applyUpdate(doc, state);
				let stored = Promise.resolve();
				doc.on("update", () => {
					stored = stored.then(() =>
						kept.store(name, Y.encodeStateAsUpdate(doc)),
					);
				});
				return doc;
			})();
			keptDocs.set(name, loaded);
		}
		return loaded;
	}

	/** The Host's document of that name, as the relay loads it, or null for one it does not serve. */
	async function hostDoc(name: string): Promise<Y.Doc | null> {
		const owned = await served.document(name);
		if (owned) return owned;
		const { kept } = served;
		if (kept && (await kept.has(name))) return keptDoc(name, kept);
		return null;
	}

	return (to) => {
		const connections = new Map<string, Connection>();
		const unwatch = network.watch(() => {
			for (const connected of connections.values()) connected.network();
		});

		async function connect(document: SyncedDocument): Promise<Connection> {
			const connected = connection(document.doc, network);
			connections.set(document.name, connected);
			const host = await hostDoc(document.name);
			const granted =
				host !== null &&
				(await served.authorize({
					documentName: document.name,
					token: to.key,
					peer: PEER,
					request: new Request(UPGRADE),
				}));
			const access = typeof granted === "object" ? granted.access : granted;
			if (host && access) connected.open(host, access === "write");
			return connected;
		}

		const channel: DocumentChannel = {
			sync(documents) {
				const names = new Set(documents.map((document) => document.name));
				for (const [name, connected] of connections) {
					if (names.has(name)) continue;
					connected.close();
					connections.delete(name);
				}
				for (const document of documents) {
					if (!connections.has(document.name)) void connect(document);
				}
			},
			inStep(names) {
				if (!network.up()) return false;
				return names.every((name) => connections.get(name)?.inStep() === true);
			},
			close() {
				unwatch();
				for (const connected of connections.values()) connected.close();
				connections.clear();
			},
		};
		return channel;
	};
}

/** One document over the channel: this Replica's copy and the Host's. */
type Connection = {
	/** The relay let it in: it syncs with the Host's copy from now on, both ways when it `writes`. */
	open(host: Y.Doc, writes: boolean): void;
	/** The network dropped or came back. */
	network(): void;
	inStep(): boolean;
	close(): void;
};

function connection(doc: Y.Doc, network: MemoryNetwork): Connection {
	let host: Y.Doc | null = null;
	let writes = false;
	let closed = false;
	let off: (() => void) | null = null;
	/** The origin of the updates this connection applies, so it does not send them back. */
	const self = {};

	/** Both sides' state, then every update as it comes. */
	function start(to: Y.Doc) {
		if (off) return;
		const toHost = (update: Uint8Array, origin: unknown) => {
			if (origin !== self && writes) Y.applyUpdate(to, update, self);
		};
		const toDevice = (update: Uint8Array, origin: unknown) => {
			if (origin !== self) Y.applyUpdate(doc, update, self);
		};
		Y.applyUpdate(doc, Y.encodeStateAsUpdate(to), self);
		if (writes) Y.applyUpdate(to, Y.encodeStateAsUpdate(doc), self);
		doc.on("update", toHost);
		to.on("update", toDevice);
		off = () => {
			doc.off("update", toHost);
			to.off("update", toDevice);
		};
	}

	function stop() {
		off?.();
		off = null;
	}

	return {
		open(to, write) {
			if (closed) return;
			host = to;
			writes = write;
			if (network.up()) start(to);
		},
		network() {
			if (!host || closed) return;
			if (network.up()) start(host);
			else stop();
		},
		inStep() {
			if (!host || !off) return false;
			return Y.snapshotContainsUpdate(
				Y.snapshot(host),
				Y.encodeStateAsUpdate(doc),
			);
		},
		close() {
			closed = true;
			stop();
		},
	};
}
