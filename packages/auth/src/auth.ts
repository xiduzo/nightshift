// The Better Auth instance: the composition root of this package. Each
// vertical gives its plugin and its rules. This file wires them together.

import { tryGetCurrentAuthEndpointContext } from "@better-auth/core/context";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { expo } from "@better-auth/expo";
import type { Database } from "@nightshift/db";
import { authSchema as schema } from "@nightshift/db";
import { Refusal } from "@nightshift/refusal";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { admin } from "better-auth/plugins/admin";
import { organization } from "better-auth/plugins/organization";
import { deviceKeyPlugin } from "./device-keys";
import { pairingPlugin } from "./pairing";
import {
	ac,
	activeSpaceId,
	ensurePersonalSpace,
	HOST_ADMIN,
	hasHostAdmin,
	type MemberChange,
	roles,
	signUpRefusal,
} from "./spaces";
import { twoFactorPlugin } from "./two-factor";

export type AuthConfig = {
	BETTER_AUTH_URL: string;
	BETTER_AUTH_SECRET: string;
	CORS_ORIGIN: string;
};

const PERSONAL = "Nobody can join a personal Space. Create a Space to share.";

/** How long an invitation link works. */
export const INVITATION_DAYS = 7;

/**
 * The address of the computer at the other end of the connection. The
 * daemon sets it on every request to Better Auth (and drops one a client
 * sends), so sign-in limits count per computer without a proxy in front.
 */
export const PEER_ADDRESS_HEADER = "x-nightshift-peer";

/**
 * Where the rate limits read the client's address, in order: Cloudflare's
 * own header (Cloudflare Tunnel), a proxy's, then the connection itself.
 */
export const CLIENT_IP_HEADERS = [
	"cf-connecting-ip",
	"x-forwarded-for",
	PEER_ADDRESS_HEADER,
];

export type AuthOptions = {
	/**
	 * A Space was made, or its Members changed (added, removed, a new role,
	 * an accepted invitation). The daemon mirrors the Members into the
	 * Space's document.
	 */
	onMembersChanged?: (spaceId: string) => Promise<void>;
	/**
	 * A Person joined a Space, left it, or got a new role, and who did it.
	 * The daemon logs it in the Space's event log.
	 */
	onMemberChange?: (change: MemberChange) => Promise<void>;
	/**
	 * More pages that may sign in, read per request: a Host's own
	 * `https://` addresses, so a browser can use any of them.
	 */
	trustedOrigins?: () => readonly string[];
};

/**
 * Better Auth with the organization plugin: a Space is an organization.
 * Every Person gets a personal Space with their account, and every new
 * session starts in it. Nobody can be invited to, added to, or delete a
 * personal Space.
 *
 * A Host is invitation-only (`spaces/members.ts`): the first Person is the
 * Host admin (the admin plugin), and every other sign-up names a pending
 * invitation of its email.
 *
 * Devices pair with a Host by device authorization (RFC 8628, the device
 * authorization plugin) and sign in with a Device key (the API key
 * plugin): see `pairing/` and `device-keys/`.
 *
 * A Person may add a second factor to their password (the two-factor
 * plugin): a code from an authenticator app, or a backup code. A Host can
 * require it for sessions from other computers (`host-access/`).
 * Signing in and the second factor are rate limited per client address,
 * always: a Host may face the internet.
 *
 * The phone app signs in as a Person, like a browser (the expo plugin). It
 * keeps the session cookie itself and sends it with each request.
 */
export function createAuth(
	env: AuthConfig,
	database: Database,
	desktopOrigins: readonly string[] = [],
	options: AuthOptions = {},
) {
	/** The Members changed: mirror them, and log who did what. */
	const changed = async (change: MemberChange) => {
		await options.onMembersChanged?.(change.spaceId);
		await options.onMemberChange?.(change);
	};
	return betterAuth({
		database: drizzleAdapter(database, {
			provider: "sqlite",
			schema,
		}),
		trustedOrigins: () => [
			env.CORS_ORIGIN,
			...desktopOrigins,
			...(options.trustedOrigins?.() ?? []),
		],
		appName: "Night Shift",
		emailAndPassword: { enabled: true },
		// The expo plugin's OAuth helper redirects to any https site. Night
		// Shift has no OAuth sign-in: the phone needs only the plugin's origin.
		disabledPaths: ["/expo-authorization-proxy"],
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		// On whatever NODE_ENV says: Better Auth turns it on in production only.
		rateLimit: {
			enabled: true,
			storage: "memory",
			customRules: {
				"/sign-in/*": { window: 60, max: 5 },
				"/two-factor/verify-*": { window: 60, max: 5 },
			},
		},
		advanced: {
			defaultCookieAttributes: {
				sameSite: "none",
				secure: true,
				httpOnly: true,
			},
			ipAddress: { ipAddressHeaders: CLIENT_IP_HEADERS },
		},
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				if (ctx.path !== "/sign-up/email") return;
				const refusal = await signUpRefusal(database, ctx.body ?? {});
				if (refusal) refuse(refusal);
			}),
		},
		databaseHooks: {
			user: {
				create: {
					// The first Person on a Host is its admin.
					before: async (data) => ({
						data: {
							...data,
							role: (await hasHostAdmin(database)) ? "user" : HOST_ADMIN,
						},
					}),
					after: async (created) => {
						await ensurePersonalSpace(database, created.id);
					},
				},
			},
			session: {
				create: {
					before: async (session) => ({
						data: {
							...session,
							activeOrganizationId: await activeSpaceId(database, session),
						},
					}),
				},
			},
		},
		plugins: [
			// The phone app: its `expo-origin` header becomes the origin, so the
			// trusted origins (the app's scheme) apply to it.
			expo(),
			admin({ defaultRole: "user", adminRoles: [HOST_ADMIN] }),
			twoFactorPlugin(),
			pairingPlugin(),
			deviceKeyPlugin(),
			organization({
				ac,
				roles,
				// No email server: a person shares the link by hand, which takes longer.
				invitationExpiresIn: INVITATION_DAYS * 24 * 3600,
				schema: {
					organization: {
						additionalFields: {
							personal: {
								type: "boolean",
								required: false,
								defaultValue: false,
								input: false,
							},
						},
					},
				},
				organizationHooks: {
					beforeCreateInvitation: async ({ organization }) => {
						if (organization.personal) refuse(PERSONAL);
					},
					beforeAddMember: async ({ organization }) => {
						if (organization.personal) refuse(PERSONAL);
					},
					beforeDeleteOrganization: async ({ organization }) => {
						if (organization.personal) {
							refuse("A personal Space stays as long as its Person.");
						}
					},
					afterCreateOrganization: ({ organization, member, user }) =>
						changed({
							kind: "joined",
							spaceId: organization.id,
							personId: user.id,
							role: member.role,
							by: user.id,
						}),
					afterAddMember: ({ organization, member, user }) =>
						changed({
							kind: "joined",
							spaceId: organization.id,
							personId: user.id,
							role: member.role,
							by: actor(),
						}),
					afterRemoveMember: ({ organization, user }) =>
						changed({
							kind: "removed",
							spaceId: organization.id,
							personId: user.id,
							by: actor(),
						}),
					afterUpdateMemberRole: ({
						organization,
						member,
						user,
						previousRole,
					}) =>
						changed({
							kind: "role",
							spaceId: organization.id,
							personId: user.id,
							role: member.role,
							previousRole,
							by: actor(),
						}),
					afterAcceptInvitation: ({ organization, member, user, invitation }) =>
						changed({
							kind: "joined",
							spaceId: organization.id,
							personId: user.id,
							role: member.role,
							by: user.id,
							invitedBy: invitation.inviterId,
						}),
				},
			}),
		],
	});
}

/** The Person whose session called the endpoint that runs now, if any. */
function actor(): string | null {
	const context = tryGetCurrentAuthEndpointContext()?.context as
		| { session?: { user?: { id?: string } } | null }
		| undefined;
	return context?.session?.user?.id ?? null;
}

/**
 * Refuses in a hook: an `APIError` for Better Auth's own endpoints, with
 * the `Refusal` as its cause, so a call through `auth.api` keeps the words.
 */
function refuse(message: string): never {
	throw new APIError("FORBIDDEN", {
		message,
		cause: new Refusal("forbidden", message),
	});
}

export type Auth = ReturnType<typeof createAuth>;
/**
 * A signed-in session, as Better Auth reads it. An interface, so a
 * declaration names it instead of writing it out: the API router's type
 * stays within what the compiler serializes.
 */
export interface Session extends InferredSession {}
type InferredSession = Auth["$Infer"]["Session"];
