import {
	type AuthOptions,
	createAuth,
	createLocalSession,
	hasLogin,
	hostPolicyFromEnv,
	localPerson,
	spaceIds,
} from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { authOriginsOf, hostAuthOrigins } from "./http";
import type { DaemonEnv } from "./runtime";

type Auth = ReturnType<typeof createAuth>;
type OwnedDevice = NonNullable<Parameters<typeof localPerson>[1]>;

/**
 * The auth block of the daemon's composition (`daemon.ts`): the sign-in of
 * this computer and the Host's rules for sessions from other computers.
 * The lanes of package `auth` edit this file, not `daemon.ts`.
 */
export function wireDaemonAuth(deps: {
	env: DaemonEnv;
	db: Database;
	port: number;
	authSecret: string;
	/** The Members of a Space changed: the Space document mirrors them. */
	onMembersChanged: NonNullable<AuthOptions["onMembersChanged"]>;
	/**
	 * The audit of Members, in the Space's event log. Called on requests,
	 * long after the engine is made.
	 */
	onMemberChange: NonNullable<AuthOptions["onMemberChange"]>;
	/** Whether this computer is a Host, and its addresses, once the settings exist. */
	hostSettings: () => { host: boolean; hostAddresses: readonly string[] };
}) {
	const { env, db } = deps;
	const auth = createAuth(
		{
			BETTER_AUTH_URL: env.BETTER_AUTH_URL,
			BETTER_AUTH_SECRET: deps.authSecret,
			CORS_ORIGIN: env.CORS_ORIGIN,
		},
		db,
		authOriginsOf(deps.port),
		{
			onMembersChanged: (spaceId) => deps.onMembersChanged(spaceId),
			onMemberChange: (change) => deps.onMemberChange(change),
			// A browser may sign in at any of the Host's addresses, the phone app
			// only at a Host. Read per request; Better Auth also asks once now,
			// before the settings exist.
			trustedOrigins: () => hostAuthOrigins(deps.hostSettings()),
		},
	);

	return {
		auth,
		/**
		 * The Host's rules for sessions from other computers: two-factor sign-in
		 * required or not (NIGHTSHIFT_REQUIRE_TWO_FACTOR). Read at start.
		 */
		hostPolicy: hostPolicyFromEnv(env),
		/** The ids of every Space this Replica knows. */
		spaceIds: () => spaceIds(db),
	};
}

/**
 * The Person who owns this computer, and their personal Space. `self` is
 * this computer's Device row, read when this is called.
 */
export async function openOwner(deps: {
	db: Database;
	auth: Auth;
	self: {
		ownerId: () => Promise<OwnedDevice["ownerId"]>;
		setOwner: OwnedDevice["setOwner"];
	};
}) {
	const { db } = deps;
	const person = await localPerson(db, {
		ownerId: await deps.self.ownerId(),
		setOwner: (personId) => deps.self.setOwner(personId),
	});
	return {
		person,
		/**
		 * One person on one computer signs in to nothing: a request from this
		 * computer without a session gets the session of the Person who owns it.
		 * It reads nothing until a request asks.
		 */
		localSession: createLocalSession(deps.auth, db, person.userId),
		/** Whether the Person who owns this computer has a sign-in for a browser elsewhere. */
		ownerHasLogin: () => hasLogin(db, person.userId),
	};
}
