import type { Database } from "@nightshift/db";

import type { Auth } from "../auth";
import { isDeviceKey } from "../device-keys";
import type { HostPolicy } from "../host-access";
import type { LocalSession } from "../local-session";
import { type Permissions, roleAllows, roleIn } from "../spaces";
import { requestAccess } from "./request";

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

/**
 * The Space a synced document belongs to, and its kind: the Space
 * document, a flow document of one of the Space's Projects (its flows
 * and schedules, or their revisions), or a Project's knowledge document
 * (its files by hash, ADR 4).
 */
export type DocumentSpace = {
	spaceId: string;
	kind: "space" | "flows" | "knowledge";
};

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
 * - `flows:<project id>` and `flows-history:<project id>`: a Member of the
 *   Project's Space, read-only. A browser saves a flow through the
 *   procedures. A Device of a Member whose role may save and remove flows
 *   and save schedules changes them: it keeps a copy, and its edits
 *   merge (ADR 2). The daemon that saves checks the flow.
 * - `knowledge:<project id>`: a Member of the Project's Space, read-only.
 *   A Device of a Member whose role may start runs changes it: it runs
 *   the steps that change the knowledge, and publishes their files (ADR
 *   4). A browser changes knowledge only through the procedures.
 *
 * A token that is a Device key (`deviceKey`) is a Device, never a session:
 * it opens its own Device document, only on its home Host (to change it),
 * the Space documents of the Spaces its owner is a Member of (to read),
 * and the flow and knowledge documents of their Projects. On its home Host it also reads
 * the Device documents of its owner's other Devices: the ones the Host
 * keeps for them, and the Host's own when its owner owns the Host (ADR 1,
 * decision 2). A Device document holds secret names, never their values.
 */
/** What a role needs to change a flow document over sync. */
const FLOW_WRITE: Permissions = {
	flow: ["save", "remove"],
	schedule: ["save"],
};

/** What a role needs to change a knowledge document over sync: its steps change the knowledge. */
const KNOWLEDGE_WRITE: Permissions = { run: ["start"] };

/** What a Device's role needs to change a document of each kind. Null: no Device changes it. */
const DEVICE_WRITE: Record<DocumentSpace["kind"], Permissions | null> = {
	space: null,
	flows: FLOW_WRITE,
	knowledge: KNOWLEDGE_WRITE,
};

export function documentAccess(options: {
	auth: Auth;
	db: Database;
	localSession: LocalSession;
	/** The Person who owns this Device. */
	ownerId: string;
	/** Whether the upgrade request came from this computer (the daemon's own rule). */
	isThisComputer: (peer: string | null, request: Request) => boolean;
	/** The Space of a document, or null for another kind of document. */
	spaceOfDocument: (documentName: string) => Promise<DocumentSpace | null>;
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

	/**
	 * A document of a Space: read-only for a Member of that Space. A
	 * Device (`device`) of a Member who may change flows writes a flow
	 * document, and one of a Member who may start runs writes a knowledge
	 * document.
	 */
	const spaceAccess = async (
		personId: string,
		documentName: string,
		device = false,
	): Promise<SyncAccess> => {
		const space = await options.spaceOfDocument(documentName);
		if (!space) return false;
		const role = await roleIn(options.db, personId, space.spaceId);
		if (role === null) return false;
		const needs = DEVICE_WRITE[space.kind];
		return device && needs && roleAllows(role, needs) ? "write" : "read";
	};

	return async ({ documentName, token, request, peer }) => {
		if (isDeviceKey(token)) {
			const key = await options.deviceKey?.(token);
			if (!key) return false;
			const context = { deviceId: key.deviceId };
			if (documentName.startsWith("device:")) {
				const owners =
					key.home && (await ownerOf(documentName)) === key.personId;
				if (!owners) return false;
				return {
					access: documentName === `device:${key.deviceId}` ? "write" : "read",
					context,
				};
			}
			const access = await spaceAccess(key.personId, documentName, true);
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
