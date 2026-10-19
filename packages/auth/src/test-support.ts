import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Database } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";

import { type Auth, createAuth } from "./index";

/** Test helpers: a migrated temp database with Better Auth on it. */

export type AuthSandbox = {
	db: Database;
	auth: Auth;
	/** A new Person with a password account, and the headers of their session. */
	signUp(name: string): Promise<{ userId: string; headers: Headers }>;
	cleanup(): void;
};

export async function createAuthSandbox(): Promise<AuthSandbox> {
	const root = mkdtempSync(join(tmpdir(), "nightshift-auth-"));
	const db = createDb({ DATABASE_URL: `file:${join(root, "nightshift.db")}` });
	await migrateDb(db);
	const auth = createAuth(
		{
			BETTER_AUTH_URL: "http://localhost:3000",
			BETTER_AUTH_SECRET: "a-test-secret-of-at-least-32-characters",
			CORS_ORIGIN: "http://localhost:3001",
		},
		db,
	);
	return {
		db,
		auth,
		async signUp(name) {
			const response = await auth.api.signUpEmail({
				body: {
					name,
					email: `${name.toLowerCase()}@example.com`,
					password: "a-long-password",
				},
				asResponse: true,
			});
			const body = (await response.json()) as { user: { id: string } };
			const cookie = response.headers
				.getSetCookie()
				.map((c) => c.split(";")[0])
				.join("; ");
			return { userId: body.user.id, headers: new Headers({ cookie }) };
		},
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}
