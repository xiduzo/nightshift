import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type { Database } from "@nightshift/db";
import * as schema from "@nightshift/db/schema/auth";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { organization } from "better-auth/plugins/organization";

import { ac, type Permissions, roles } from "./access";
import { DEVICE_KEY_PREFIX } from "./device-keys";
import { PAIRING_CODE_TTL, PAIRING_POLL_INTERVAL } from "./pairing";
import { activeSpaceId, ensurePersonalSpace } from "./spaces";

export type { Permissions, Role } from "./access";
export { roleAllows, statements } from "./access";
export type { Space } from "./spaces";

export type AuthConfig = {
	BETTER_AUTH_URL: string;
	BETTER_AUTH_SECRET: string;
	CORS_ORIGIN: string;
};

const PERSONAL = "Nobody can join a personal Space. Create a Space to share.";

export type AuthOptions = {
	/**
	 * A Space was made, or its Members changed (added, removed, a new role,
	 * an accepted invitation). The daemon mirrors the Members into the
	 * Space's document.
	 */
	onMembersChanged?: (spaceId: string) => Promise<void>;
};

/**
 * Better Auth with the organization plugin: a Space is an organization.
 * Every Person gets a personal Space with their account, and every new
 * session starts in it. Nobody can be invited to, added to, or delete a
 * personal Space.
 *
 * Devices pair with a Host by device authorization (RFC 8628, the device
 * authorization plugin) and sign in with a Device key (the API key
 * plugin): see `pairing.ts` and `device-keys.ts`.
 */
export function createAuth(
	env: AuthConfig,
	database: Database,
	desktopOrigins: readonly string[] = [],
	options: AuthOptions = {},
) {
	const membersChanged = async (data: { organization: { id: string } }) => {
		await options.onMembersChanged?.(data.organization.id);
	};
	return betterAuth({
		database: drizzleAdapter(database, {
			provider: "sqlite",
			schema,
		}),
		trustedOrigins: [env.CORS_ORIGIN, ...desktopOrigins],
		emailAndPassword: { enabled: true },
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		advanced: {
			defaultCookieAttributes: {
				sameSite: "none",
				secure: true,
				httpOnly: true,
			},
		},
		databaseHooks: {
			user: {
				create: {
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
			pairingPlugin(),
			apiKey({
				defaultPrefix: DEVICE_KEY_PREFIX,
				enableMetadata: true,
				// A Device calls its Host every few seconds; idle expiry, not a
				// request count, ends a key nobody uses (`device-keys.ts`).
				rateLimit: { enabled: false },
				keyExpiration: { minExpiresIn: 1, maxExpiresIn: 365 },
			}),
			organization({
				ac,
				roles,
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
					afterCreateOrganization: membersChanged,
					afterAddMember: membersChanged,
					afterRemoveMember: membersChanged,
					afterUpdateMemberRole: membersChanged,
					afterAcceptInvitation: membersChanged,
				},
			}),
		],
	});
}

/**
 * The device authorization plugin, typed by name: its inferred type names a
 * type `better-call` does not export, which a declaration cannot name.
 */
export interface PairingPlugin
	extends ReturnType<typeof deviceAuthorization<undefined>> {}

function pairingPlugin(): PairingPlugin {
	return deviceAuthorization({
		expiresIn: PAIRING_CODE_TTL,
		interval: PAIRING_POLL_INTERVAL,
		// The client is the joining Device: its id.
		validateClient: (clientId) => /^[\w-]{1,64}$/.test(clientId),
	});
}

function refuse(message: string): never {
	throw new APIError("FORBIDDEN", { message });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];

/**
 * Whether the session's Person may do `permissions` in the Space: the
 * organization plugin's `hasPermission`, with the request's headers.
 */
export async function hasPermission(
	auth: Auth,
	headers: Headers,
	spaceId: string,
	permissions: Permissions,
): Promise<boolean> {
	const result = await auth.api
		.hasPermission({
			headers,
			body: { organizationId: spaceId, permissions },
		})
		.catch(() => null);
	return result?.success === true;
}
