import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type { Database } from "@nightshift/db";
import * as schema from "@nightshift/db/schema/auth";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { organization } from "better-auth/plugins/organization";

import { ac, type Permissions, roles } from "./access";
import { activeSpaceId, ensurePersonalSpace } from "./spaces";

export type { Permissions, Role } from "./access";
export { statements } from "./access";
export type { Space } from "./spaces";

export type AuthConfig = {
	BETTER_AUTH_URL: string;
	BETTER_AUTH_SECRET: string;
	CORS_ORIGIN: string;
};

const PERSONAL = "Nobody can join a personal Space. Create a Space to share.";

/**
 * Better Auth with the organization plugin: a Space is an organization.
 * Every Person gets a personal Space with their account, and every new
 * session starts in it. Nobody can be invited to, added to, or delete a
 * personal Space.
 */
export function createAuth(
	env: AuthConfig,
	database: Database,
	desktopOrigins: readonly string[] = [],
) {
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
				},
			}),
		],
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
