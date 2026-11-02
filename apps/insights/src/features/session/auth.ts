import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type { InsightsDb } from "@nightshift/insights";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins/admin";
import { twoFactor } from "better-auth/plugins/two-factor";

import type { Env } from "@/shared/config";

import * as schema from "./schema";

const SESSION_SECONDS = 12 * 60 * 60;

/** GitHub, and email with a password. Sign-up stays off. */
export function createAdminAuth(db: InsightsDb, env: Env) {
	const allowed = new Set(logins(env.INSIGHTS_GITHUB_LOGINS));
	const github =
		env.INSIGHTS_GITHUB_CLIENT_ID !== "" &&
		env.INSIGHTS_GITHUB_CLIENT_SECRET !== "";
	const fallback = `http://127.0.0.1:${env.INSIGHTS_PORT}`;
	return betterAuth({
		database: drizzleAdapter(db, {
			provider: "pg",
			schema,
		}),
		appName: "Night Shift",
		secret: env.BETTER_AUTH_SECRET,
		baseURL: {
			allowedHosts: ["*"],
			fallback,
			protocol: "auto",
		},
		trustedOrigins: (request) => {
			const origin = request?.headers.get("origin");
			return origin ? [origin, fallback] : [fallback];
		},
		emailAndPassword: { enabled: true, disableSignUp: true },
		socialProviders: github
			? {
					github: {
						clientId: env.INSIGHTS_GITHUB_CLIENT_ID,
						clientSecret: env.INSIGHTS_GITHUB_CLIENT_SECRET,
					},
				}
			: undefined,
		session: { expiresIn: SESSION_SECONDS },
		rateLimit: {
			enabled: true,
			storage: "memory",
			customRules: {
				"/sign-in/*": { window: 60, max: 5 },
				"/two-factor/verify-*": { window: 60, max: 5 },
			},
		},
		advanced: {
			ipAddress: { disableIpTracking: true },
		},
		user: {
			validateUserInfo: (data) => {
				if (data.source.method !== "oauth") return;
				const login = data.source.oauth?.profile?.login;
				if (typeof login === "string" && allowed.has(login.toLowerCase()))
					return;
				return {
					error: "github_login",
					errorDescription: "This GitHub account cannot sign in.",
				};
			},
		},
		plugins: [
			admin({ defaultRole: "user", adminRoles: ["admin"] }),
			twoFactor({ issuer: "Night Shift" }),
		],
	});
}

export type AdminAuth = ReturnType<typeof createAdminAuth>;

function logins(value: string): string[] {
	return value
		.split(",")
		.map((item) => item.trim().toLowerCase())
		.filter((item) => item.length > 0);
}
