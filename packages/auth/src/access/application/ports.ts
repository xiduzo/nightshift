import type { Role, Space } from "../../spaces";
import type { DocumentOf, SyncDeviceKey } from "../domain/sync-access";
import type { HostPolicy } from "../host-access";

/**
 * The driven ports of access. A port of its own has a real adapter, an
 * in-memory adapter and a contract suite in `adapters/out/`. Another
 * vertical fills a port with `@filledBy`: the wire passes it in. `S` is a
 * session as Better Auth reads it: the wire names the full type.
 */

/** Reads the session a request carries. */
export type SessionReader<S> = {
	/** The live session the headers carry, else null. */
	read(headers: Headers): Promise<S | null>;
};

/**
 * A Person's changes to Spaces and their Members, through the organization
 * plugin. The headers carry the session of the Person who acts: the plugin
 * checks their role again, and its hooks name them. Each call throws a
 * `Refusal` in Night Shift's words when the plugin refuses it.
 */
export type Organizations = {
	/** Makes the Space the session's active one. */
	setActive(headers: Headers, spaceId: string): Promise<void>;
	/** A new Space with the session's Person as its owner, and the session's active one. Null: not made. */
	create(
		headers: Headers,
		space: { name: string; slug: string },
	): Promise<{ id: string } | null>;
	/** A pending invitation of that email to the Space, with a role. */
	invite(
		headers: Headers,
		invitation: { email: string; role: Role; spaceId: string },
	): Promise<{ id: string }>;
	cancelInvitation(headers: Headers, invitationId: string): Promise<void>;
	setRole(
		headers: Headers,
		change: { memberId: string; role: Role; spaceId: string },
	): Promise<void>;
	remove(
		headers: Headers,
		member: { memberId: string; spaceId: string },
	): Promise<void>;
	/** The session's Person joins the Space of an invitation of their email. Null: not joined. */
	accept(
		headers: Headers,
		invitationId: string,
	): Promise<{ spaceId: string } | null>;
};

/**
 * The Spaces of a Person and their role in each.
 * @filledBy auth/spaces
 */
export type MemberSpaces = {
	/** The Spaces the Person is a member of, the personal one first. */
	spacesOf(personId: string): Promise<Space[]>;
	/** The Person's personal Space: made when there is none. */
	ensurePersonalSpace(personId: string): Promise<string>;
	/** The Person's role in a Space, or null. */
	roleOf(personId: string, spaceId: string): Promise<Role | null>;
};

/**
 * The local Person's session, for a request from this computer without a
 * session of its own.
 * @filledBy auth
 */
export type LocalSessions<S> = {
	/** The request's session, else the local Person's, with the headers that carry it. */
	resolve(headers: Headers): Promise<{ session: S | null; headers: Headers }>;
	/** The headers to pass on to Better Auth: the request's own, else with the local cookie. */
	headers(headers: Headers): Promise<Headers>;
};

/**
 * The documents this daemon serves, and who it serves them to: the
 * relay's side of the sync access.
 * @filledBy devices
 */
export type SyncDocuments<S> = {
	/** The Person who owns this Device. */
	ownerId: string;
	/** The local Person's session, for a connection from this computer. */
	localSession: LocalSessions<S>;
	/** Whether the upgrade request came from this computer (the daemon's own rule). */
	isThisComputer(peer: string | null, request: Request): boolean;
	/** What a document is, or null for a name this daemon does not serve. */
	documentOf(documentName: string): Promise<DocumentOf | null>;
	/**
	 * The Host's rules for sessions from other computers. A session the
	 * Host refuses (two-factor required, not on) opens no document.
	 */
	policy?: HostPolicy;
	/** The owner of a document this daemon keeps for a paired Device, else null. */
	keptOwner?(documentName: string): Promise<string | null>;
	/**
	 * A Device key, resolved: its Device, its owner here, and whether this
	 * daemon is the Device's home Host. Null: not a valid key here.
	 */
	deviceKey?(token: string): Promise<SyncDeviceKey | null>;
};
