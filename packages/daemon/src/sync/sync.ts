import { Hocuspocus } from "@hocuspocus/server";
import type { SyncAuthorize } from "@nightshift/auth";
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import * as Y from "yjs";

/**
 * The relay's document half: Hocuspocus over Bun's own WebSockets, in the
 * daemon's process. A client (a UI, or another Device over its Link)
 * opens a document by name and Yjs keeps both sides in step. It serves
 * two kinds of document:
 *
 * - Owned documents: this Device's document, every Space document and
 *   the flow documents of the Projects this Replica has.
 *   The engine holds each one (a `PersistedDocument`) and writes it to
 *   the Replica on every update. Hocuspocus only carries their updates:
 *   when it loads one it takes the engine's state, and from then on every
 *   update goes both ways (the `BRIDGE` origin) until it unloads it.
 * - Kept documents (`KeptDocuments`): on a Host, the Device documents of
 *   the Devices whose home Host it is. The engine never opens them.
 *   Hocuspocus loads them from the Replica's `ydoc` rows (`documentRows`)
 *   and stores them back after changes, with its own debounce.
 *
 * This is the transport only. Who may open which document is the policy
 * of `@nightshift/auth` (`documentAccess`).
 *
 * One per process: a client's connection outlives a `bun --hot` reload.
 * The next daemon keeps it and binds it to its own closures (`keepSync`).
 */

/**
 * Documents a daemon keeps for others: a Host keeps the Device documents
 * of the Devices whose home Host it is. Hocuspocus loads them from the
 * Replica's `ydoc` rows and stores them back after changes.
 */
export type KeptDocuments = {
	/** Whether this daemon keeps a document of that name. */
	has(name: string): boolean | Promise<boolean>;
	fetch(name: string): Promise<Uint8Array | null>;
	store(name: string, state: Uint8Array): Promise<void>;
};

/** What the relay reads, from the daemon that made it or kept it last. */
export type SyncOptions = {
	/** The live document the daemon owns under that name, or null. */
	document: (name: string) => Y.Doc | null | Promise<Y.Doc | null>;
	/** The documents it keeps for others. None by default. */
	kept?: KeptDocuments;
	authorize: SyncAuthorize;
};

export type Sync = {
	/**
	 * Reads `options` from now on: the closures of the next daemon after a
	 * reload. The connections stay.
	 */
	rebind(options: SyncOptions): void;
	/** For the daemon's fetch handler: upgrades a request for the sync path. */
	upgrade(request: Request, server: Server<SocketData>): Response | undefined;
	/** Bun's WebSocket handlers for the upgraded sockets. */
	websocket: WebSocketHandler<SocketData>;
	hocuspocus: Hocuspocus;
	/** Ends the connections whose context matches: a Device whose access was removed. */
	disconnect(match: (context: Record<string, unknown>) => boolean): void;
	/** Closes every connection. */
	close(): Promise<void>;
};

type ClientConnection = ReturnType<Hocuspocus["handleConnection"]>;

export type SocketData = {
	request: Request;
	peer: string | null;
	connection?: ClientConnection;
};

/** Updates the bridge applies, so it does not send them back. */
const BRIDGE = Symbol("sync-bridge");

/** What `bun --hot` keeps of the relay. */
export type KeptSync = { nightshiftSync?: Sync };

/** The daemon's kept slot of the relay (`hotSlots` of `runtime/hot.ts`). */
export type SyncSlot = {
	keep(
		name: "nightshiftSync",
		make: () => Sync,
		close: (sync: Sync) => unknown,
	): Promise<Sync>;
};

/**
 * The relay of this process: the one the daemon before kept, bound to
 * `options` now, else a new one. A client's connection outlives the
 * reload, and each new request meets the newest daemon's database, auth,
 * Device keys and registry. The daemon's stop closes the connections.
 */
export async function keepSync(
	slots: SyncSlot,
	options: SyncOptions,
): Promise<Sync> {
	const sync = await slots.keep(
		"nightshiftSync",
		() => createSync(options),
		(kept) => kept.close(),
	);
	// A relay of an older version cannot be bound again: it stays as it is
	// until the next restart.
	if (typeof sync.rebind === "function") sync.rebind(options);
	return sync;
}

export function createSync(first: SyncOptions): Sync {
	const unbind = new Map<string, () => void>();
	let options = first;
	const isKept = async (name: string) => {
		const { kept } = options;
		return (
			(await options.document(name)) === null &&
			kept !== undefined &&
			(await kept.has(name))
		);
	};

	const hocuspocus = new Hocuspocus({
		quiet: true,
		async onAuthenticate({
			documentName,
			token,
			request,
			context,
			connectionConfig,
		}) {
			const peer = (context as { peer?: string | null }).peer ?? null;
			const known =
				(await options.document(documentName)) !== null ||
				(await isKept(documentName));
			const granted =
				known &&
				(await options.authorize({ documentName, token, peer, request }));
			const access = typeof granted === "object" ? granted.access : granted;
			if (!access) throw new Error("Not allowed.");
			connectionConfig.readOnly = access === "read";
			return typeof granted === "object" ? granted.context : undefined;
		},
		async onLoadDocument({ documentName, document }) {
			const { kept } = options;
			const owned = await options.document(documentName);
			if (!owned && kept && (await isKept(documentName))) {
				const state = await kept.fetch(documentName);
				if (state) Y.applyUpdate(document, state);
				return;
			}
			if (!owned) throw new Error(`No document ${documentName} here.`);
			Y.applyUpdate(document, Y.encodeStateAsUpdate(owned), BRIDGE);
			const toOwner = (update: Uint8Array, origin: unknown) => {
				if (origin !== BRIDGE) Y.applyUpdate(owned, update, BRIDGE);
			};
			const toClients = (update: Uint8Array, origin: unknown) => {
				if (origin !== BRIDGE) Y.applyUpdate(document, update, BRIDGE);
			};
			document.on("update", toOwner);
			owned.on("update", toClients);
			unbind.get(documentName)?.();
			unbind.set(documentName, () => {
				document.off("update", toOwner);
				owned.off("update", toClients);
			});
		},
		async onStoreDocument({ documentName, document }) {
			const { kept } = options;
			// The Owner writes its own documents; this stores the kept ones.
			if (kept && (await isKept(documentName))) {
				await kept.store(documentName, Y.encodeStateAsUpdate(document));
			}
		},
		async afterUnloadDocument({ documentName }) {
			unbind.get(documentName)?.();
			unbind.delete(documentName);
		},
	});

	return {
		hocuspocus,
		rebind(next) {
			options = next;
		},
		upgrade(request, server) {
			const peer = server.requestIP(request)?.address ?? null;
			// Bun empties the request's headers once it upgrades: keep a copy.
			const copy = new Request(request.url, { headers: request.headers });
			if (server.upgrade(request, { data: { request: copy, peer } })) return;
			return new Response("Expected a WebSocket.", { status: 426 });
		},
		websocket: {
			open(ws: ServerWebSocket<SocketData>) {
				ws.data.connection = hocuspocus.handleConnection(ws, ws.data.request, {
					peer: ws.data.peer,
				});
			},
			message(ws, message) {
				ws.data.connection?.handleMessage(
					typeof message === "string"
						? new TextEncoder().encode(message)
						: new Uint8Array(message),
				);
			},
			close(ws, code, reason) {
				ws.data.connection?.handleClose({ code, reason });
			},
			// Bun answers the pings itself; a pong is activity, like a message.
			pong(ws) {
				ws.data.connection?.touch();
			},
		},
		disconnect(match) {
			for (const document of hocuspocus.documents.values()) {
				for (const connection of document.getConnections()) {
					const context = (connection.context ?? {}) as Record<string, unknown>;
					if (match(context))
						connection.webSocket.close(4403, "Access removed.");
				}
			}
		},
		async close() {
			hocuspocus.closeConnections();
			for (const off of unbind.values()) off();
			unbind.clear();
		},
	};
}
