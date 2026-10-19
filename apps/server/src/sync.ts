import { Hocuspocus } from "@hocuspocus/server";
import type { Auth } from "@nightshift/auth";
import { isDeviceKey } from "@nightshift/auth/device-keys";
import type { LocalSession } from "@nightshift/auth/local-session";
import { requestAccess } from "@nightshift/auth/request";
import type { Database } from "@nightshift/db";
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import * as Y from "yjs";

import { isThisComputer } from "./this-computer";

/**
 * The relay's document half: Hocuspocus over Bun's own WebSockets, in the
 * daemon's process. A client (a UI, later another Device of the same
 * owner) opens a document by name and Yjs keeps both sides in step.
 *
 * The daemon is the Owner of the documents it serves: it holds each one
 * (the engine's `DeviceDocument`) and writes it to the Replica itself.
 * Hocuspocus only carries updates, so it gets no persistence of its own:
 * when it loads a document it takes the Owner's state, and from then on
 * every update goes both ways until it unloads the document.
 */

/**
 * Who may open which document. Throws or returns false to refuse. An
 * object allows, and becomes the connection's context (`disconnect`
 * matches on it).
 */
export type SyncAuthorize = (request: {
	documentName: string;
	/** The token the client sent (the provider's `token`). */
	token: string;
	/** The client's address, as the socket saw it. */
	peer: string | null;
	/** The upgrade request: its headers carry `Origin` and the session cookie. */
	request: Request;
}) => SyncAllowed | Promise<SyncAllowed>;

export type SyncAllowed = boolean | Record<string, unknown>;

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

export type Sync = {
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

export function createSync(options: {
	/** The live document the daemon owns under that name, or null. */
	document: (name: string) => Y.Doc | null;
	/** The documents it keeps for others. None by default. */
	kept?: KeptDocuments;
	authorize: SyncAuthorize;
}): Sync {
	const unbind = new Map<string, () => void>();
	const { kept } = options;
	const isKept = async (name: string) =>
		options.document(name) === null &&
		kept !== undefined &&
		(await kept.has(name));

	const hocuspocus = new Hocuspocus({
		quiet: true,
		async onAuthenticate({ documentName, token, request, context }) {
			const peer = (context as { peer?: string | null }).peer ?? null;
			const known =
				options.document(documentName) !== null || (await isKept(documentName));
			const allowed =
				known &&
				(await options.authorize({ documentName, token, peer, request }));
			if (!allowed) throw new Error("Not allowed.");
			return typeof allowed === "object" ? allowed : undefined;
		},
		async onLoadDocument({ documentName, document }) {
			const owned = options.document(documentName);
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

/**
 * The Device document opens for its owner only: the Person whose session
 * the request carries. A request from this computer (`isThisComputer`)
 * without a session of its own gets the local Person's session, exactly
 * as the procedures do, so one rule decides both.
 *
 * Another Device of the same owner opens it with its Device key (the
 * provider's token), but only on its home Host: a key of a Device that
 * joined this daemon as a guest Host opens no Device document. A token
 * that is a Device key never falls back to the session rules. On a Host,
 * the owner of a document it keeps for a paired Device is that Device's
 * owner (`keptOwner`).
 */
export function ownerOnly(options: {
	auth: Auth;
	db: Database;
	localSession: LocalSession;
	/** The Person who owns this Device. */
	ownerId: string;
	trustedOrigins: ReadonlySet<string>;
	/** The owner of a document this daemon keeps for a paired Device, else null. */
	keptOwner?: (documentName: string) => Promise<string | null>;
	/**
	 * A Device key, resolved: its Device, its owner here, and whether this
	 * daemon is the Device's home Host. Null: not a valid key here.
	 */
	deviceKey?: (token: string) => Promise<SyncDeviceKey | null>;
}): SyncAuthorize {
	return async ({ documentName, token, request, peer }) => {
		const owner = (await options.keptOwner?.(documentName)) ?? options.ownerId;
		if (isDeviceKey(token)) {
			const key = await options.deviceKey?.(token);
			if (!key?.home || key.personId !== owner) return false;
			return { deviceId: key.deviceId };
		}
		const local = isThisComputer(
			peer,
			request.headers.get("origin"),
			options.trustedOrigins,
		);
		const { session } = await requestAccess(
			options.auth,
			options.db,
			request.headers,
			local ? options.localSession : null,
		);
		return session?.user.id === owner;
	};
}

/** A Device key as the relay needs it. */
export type SyncDeviceKey = {
	deviceId: string;
	personId: string;
	/** This daemon is the Device's home Host. */
	home: boolean;
};
