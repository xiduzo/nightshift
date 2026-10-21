import type { Database } from "@nightshift/db";

import type { Auth } from "./auth";
import { isDeviceKey } from "./device-keys";
import type { HostPolicy } from "./host-access";
import type { LocalSession } from "./local-session";
import { requestAccess } from "./request";
import { roleIn } from "./spaces";

/**
 * What a client may do with a synced document: change it, only read it (a
 * read-only connection: the relay drops its updates), or nothing.
 */
export type SyncAccess = "write" | "read" | false;

/**
 * Access with the connection's context: the relay's `disconnect` matches on
 * it (a Device whose access was removed).
 */
export type SyncGrant = {
	access: Exclude<SyncAccess, false>;
	context: Record<string, unknown>;
};

/** Who may open which document. Throws or returns false to refuse. */
export type SyncAuthorize = (request: {
	documentName: string;
	/** The token the client sent (the provider's `token`). */
	token: string;
	/** The client's address, as the socket saw it. */
	peer: string | null;
	/** The upgrade request: its headers carry `Origin` and the session cookie. */
	request: Request;
}) => SyncAccess | SyncGrant | Promise<SyncAccess | SyncGrant>;

/** A Device key as the relay needs it. */
export type SyncDeviceKey = {
	deviceId: string;
	personId: string;
	/** This daemon is the Device's home Host. */
	home: boolean;
};

/**
 * Who may open which document, by its kind. The request's session decides:
 * a request from this computer (`isThisComputer`) without a session of its
 * own gets the local Person's session, exactly as the procedures do, so
 * one rule decides both.
 *
 * - `device:<id>`: its owner, to change it. On a Host, the owner of a
 *   document it keeps for a paired Device is that Device's owner
 *   (`keptOwner`).
 * - `space:<id>`: a Member of that Space, read-only. A Yjs update cannot
 *   be checked per action (a rename, a removal), so every write to a
 *   Space document goes through the procedures, which check the role
 *   and log an event.
 *
 * A token that is a Device key (`deviceKey`) is a Device, never a session:
 * it opens its own Device document, only on its home Host (to change it),
 * and the Space documents of the Spaces its owner is a Member of (to read).
 */
export function documentAccess(options: {
	auth: Auth;
	db: Database;
	localSession: LocalSession;
	/** The Person who owns this Device. */
	ownerId: string;
	/** Whether the upgrade request came from this computer (the daemon's own rule). */
	isThisComputer: (peer: string | null, request: Request) => boolean;
	/** The Space of a document name, or null for another kind of document. */
	spaceIdOf: (documentName: string) => string | null;
	/**
	 * The Host's rules for sessions from other computers. A session the
	 * Host refuses (two-factor required, not on) opens no document.
	 */
	policy?: HostPolicy;
	/** The owner of a document this daemon keeps for a paired Device, else null. */
	keptOwner?: (documentName: string) => Promise<string | null>;
	/**
	 * A Device key, resolved: its Device, its owner here, and whether this
	 * daemon is the Device's home Host. Null: not a valid key here.
	 */
	deviceKey?: (token: string) => Promise<SyncDeviceKey | null>;
}): SyncAuthorize {
	const ownerOf = async (documentName: string) =>
		(await options.keptOwner?.(documentName)) ?? options.ownerId;

	/** A Space document: read-only for a Member of that Space. */
	const spaceAccess = async (
		personId: string,
		documentName: string,
	): Promise<SyncAccess> => {
		const spaceId = options.spaceIdOf(documentName);
		if (!spaceId) return false;
		return (await roleIn(options.db, personId, spaceId)) === null
			? false
			: "read";
	};

	return async ({ documentName, token, request, peer }) => {
		if (isDeviceKey(token)) {
			const key = await options.deviceKey?.(token);
			if (!key) return false;
			const context = { deviceId: key.deviceId };
			if (documentName.startsWith("device:")) {
				const own =
					documentName === `device:${key.deviceId}` &&
					key.home &&
					(await ownerOf(documentName)) === key.personId;
				return own ? { access: "write", context } : false;
			}
			const access = await spaceAccess(key.personId, documentName);
			return access ? { access, context } : false;
		}
		const local = options.isThisComputer(peer, request);
		const { session, hostAccess } = await requestAccess(
			options.auth,
			options.db,
			request.headers,
			local ? options.localSession : null,
			options.policy,
		);
		if (!session || !hostAccess.allowed) return false;
		if (documentName.startsWith("device:")) {
			return session.user.id === (await ownerOf(documentName))
				? "write"
				: false;
		}
		return spaceAccess(session.user.id, documentName);
	};
}
