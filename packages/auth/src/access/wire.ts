import { randomUUID } from "node:crypto";
import type { Database } from "@nightshift/db";
import type { Auth, Session } from "../auth";
import type { HostAccess, TWO_FACTOR_REQUIRED } from "../host-access";
import { wireSpaces } from "../spaces";
import { betterAuthOrganizations } from "./adapters/out/better-auth-organizations";
import { betterAuthSessionReader } from "./adapters/out/better-auth-session-reader";
import { authorizeDocument } from "./application/authorize-document";
import { openAuthEndpoint } from "./application/open-auth-endpoint";
import {
	type OpenRequest,
	openRequest,
	type RequestAccessOf,
} from "./application/open-request";
import type { SyncDocuments } from "./application/ports";
import type { SpaceAccessOf, TwoFactorRequired } from "./domain/space-access";
import type { SyncAuthorize } from "./domain/sync-access";

/**
 * The wiring of access: the one place that builds its real adapters and
 * binds each use case to its ports. It names Better Auth's session type
 * for the use cases, which take any session shape.
 */

/** What the package gives access: what the real adapters stand on. */
export type AccessDeps = {
	auth: Auth;
	db: Database;
};

/** Who a request is, in which Space, and what they may do there (`openRequest`). */
export type RequestAccess = RequestAccessOf<Session>;

/** A request that works in a Space: its session and that Space. Else why not (`spaceAccess`). */
export type SpaceAccess = SpaceAccessOf<Session>;

/** What the relay tells the sync access about the documents it serves. */
export type SyncSetup = SyncDocuments<Session>;

/** `A`, when it is a `B`, else a compile error. */
type Is<A extends B, B> = A;

/**
 * The domain writes the Host's refusal code itself (`TwoFactorRequired`).
 * It is the code of `host-access/`: this type does not compile when the
 * two differ.
 */
export type HostRefusalCode = Is<
	typeof TWO_FACTOR_REQUIRED,
	TwoFactorRequired
> &
	Is<TwoFactorRequired, typeof TWO_FACTOR_REQUIRED>;

/** The use cases of access, bound to their ports. */
export type Access = {
	/** Who a request is, in which Space, and what they may do there. */
	openRequest(request: OpenRequest<Session>): Promise<RequestAccess>;
	/** The headers and the Host's decision for a call to Better Auth's own endpoints. */
	openAuthEndpoint(
		request: OpenRequest<Session>,
	): Promise<{ headers: Headers; hostAccess: HostAccess }>;
	/** Who may open which synced document (`authorizeDocument`), for the documents of `setup`. */
	authorizeDocuments(setup: SyncSetup): SyncAuthorize;
};

export function wireAccess(deps: AccessDeps): Access {
	const spaces = wireSpaces({ db: deps.db });
	const ports = {
		sessionReader: betterAuthSessionReader(deps.auth),
		organizations: betterAuthOrganizations(deps.auth),
		members: {
			spacesOf: async (personId: string) => spaces.listSpaces({ personId }),
			ensurePersonalSpace: async (personId: string) =>
				spaces.personal.ensurePersonalSpace({ personId }),
			roleOf: async (personId: string, spaceId: string) =>
				spaces.findRole({ personId, spaceId }),
		},
		newId: () => randomUUID(),
	};
	const open = openRequest(ports);
	return {
		openRequest: open,
		openAuthEndpoint: openAuthEndpoint(ports),
		authorizeDocuments: (setup) =>
			authorizeDocument({ ...ports, documents: setup, openRequest: open }),
	};
}
