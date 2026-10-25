import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Database } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";

import { type Auth, type AuthOptions, createAuth } from "../auth";

/** Test helpers: a migrated temp database with Better Auth on it. */

const PASSWORD = "a-long-password";

/** The session cookies a response sets, as request headers. */
export function cookiesOf(response: Response): Headers {
	const cookie = response.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");
	return new Headers({ cookie });
}

export type AuthSandbox = {
	db: Database;
	auth: Auth;
	/**
	 * A new Person with a password account, made as the Host admin makes
	 * one (the Host is invitation-only), and the headers of their session.
	 */
	signUp(name: string): Promise<{ userId: string; headers: Headers }>;
	/** Signs in with email and password: the headers of the new session. */
	signIn(email: string, password?: string): Promise<Headers>;
	/**
	 * Counts the statements the database runs from now on: one per
	 * statement, in a batch too. Returns the count so far.
	 */
	countStatements(): () => number;
	cleanup(): void;
};

export async function createAuthSandbox(
	options: AuthOptions = {},
): Promise<AuthSandbox> {
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
		[],
		options,
	);
	async function signIn(email: string, password = PASSWORD) {
		const response = await auth.api.signInEmail({
			body: { email, password },
			asResponse: true,
		});
		if (!response.ok) throw new Error(`Sign-in failed: ${response.status}`);
		return cookiesOf(response);
	}
	return {
		db,
		auth,
		async signUp(name) {
			const email = `${name.toLowerCase()}@example.com`;
			const { user } = await auth.api.createUser({
				body: { name, email, password: PASSWORD },
			});
			return { userId: user.id, headers: await signIn(email) };
		},
		signIn,
		countStatements: () => countStatements(db),
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

function countStatements(db: Database): () => number {
	const client = db.$client;
	let count = 0;
	const execute = client.execute.bind(client);
	const batch = client.batch.bind(client);
	client.execute = ((...args: Parameters<typeof execute>) => {
		count += 1;
		return execute(...args);
	}) as typeof client.execute;
	client.batch = ((...args: Parameters<typeof batch>) => {
		count += args[0].length;
		return batch(...args);
	}) as typeof client.batch;
	return () => count;
}
