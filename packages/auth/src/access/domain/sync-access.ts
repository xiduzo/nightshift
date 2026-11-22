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

/** One connection the relay asks about. */
export type SyncRequest = {
	documentName: string;
	/** The token the client sent (the provider's `token`). */
	token: string;
	/** The client's address, as the socket saw it. */
	peer: string | null;
	/** The upgrade request: its headers carry `Origin` and the session cookie. */
	request: Request;
};

/** Who may open which document. Throws or returns false to refuse. */
export type SyncAuthorize = (
	request: SyncRequest,
) => SyncAccess | SyncGrant | Promise<SyncAccess | SyncGrant>;

/**
 * What a synced document is, as the access rules read it: a Device's
 * document, or a document of a Space: the Space document, a flow document
 * of one of the Space's Projects (its flows and schedules, or their
 * revisions), or a Project's knowledge document (its files by hash, ADR 4).
 */
export type DocumentOf =
	| { kind: "device"; deviceId: string }
	| { kind: "space" | "flows" | "knowledge"; spaceId: string };

/** A document of a Space. */
export type SpaceDocumentOf = Exclude<DocumentOf, { kind: "device" }>;

/** A Device key as the relay needs it. */
export type SyncDeviceKey = {
	deviceId: string;
	personId: string;
	/** This daemon is the Device's home Host. */
	home: boolean;
};
