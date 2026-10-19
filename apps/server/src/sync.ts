import { Hocuspocus } from "@hocuspocus/server";
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import * as Y from "yjs";

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

/** Who may open which document. Throws or returns false to refuse. */
export type SyncAuthorize = (request: {
	documentName: string;
	/** The token the client sent (the provider's `token`). */
	token: string;
	/** The client's address, as the socket saw it. */
	peer: string | null;
	/** The upgrade request: its headers carry `Origin` and the session cookie. */
	request: Request;
}) => boolean | Promise<boolean>;

export type Sync = {
	/** For the daemon's fetch handler: upgrades a request for the sync path. */
	upgrade(request: Request, server: Server<SocketData>): Response | undefined;
	/** Bun's WebSocket handlers for the upgraded sockets. */
	websocket: WebSocketHandler<SocketData>;
	hocuspocus: Hocuspocus;
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
	authorize: SyncAuthorize;
}): Sync {
	const unbind = new Map<string, () => void>();

	const hocuspocus = new Hocuspocus({
		quiet: true,
		async onAuthenticate({ documentName, token, request, context }) {
			const peer = (context as { peer?: string | null }).peer ?? null;
			const allowed =
				options.document(documentName) !== null &&
				(await options.authorize({ documentName, token, peer, request }));
			if (!allowed) throw new Error("Not allowed.");
		},
		async onLoadDocument({ documentName, document }) {
			const owned = options.document(documentName);
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
		async close() {
			hocuspocus.closeConnections();
			for (const off of unbind.values()) off();
			unbind.clear();
		},
	};
}

/**
 * Slice 3's rule: this computer only. The client is on this computer
 * (a loopback address) and, when it is a browser, on one of the UI's
 * origins, so no website can open a socket to the daemon. Slice 4
 * replaces this with the Device key: the key's owner, and the home-Host
 * rule (a Device document syncs only to Devices of the same owner).
 */
export function thisComputerOnly(origins: readonly string[]): SyncAuthorize {
	return ({ peer, request }) => {
		if (!peer || !isLoopback(peer)) return false;
		const origin = request.headers.get("origin");
		return origin === null || origins.includes(origin);
	};
}

function isLoopback(address: string): boolean {
	return (
		address === "::1" ||
		address.startsWith("127.") ||
		address.startsWith("::ffff:127.")
	);
}
