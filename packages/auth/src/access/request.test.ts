import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
	type AuthSandbox,
	createAuthSandbox,
	testRequestAccess,
} from "../testing";
import {
	testAuthEndpointAccess,
	testLocalPerson,
	testLocalSession,
} from "../testing/wires";

/** The access of one request: read once, decided in memory. */

let sandbox: AuthSandbox;
beforeEach(async () => {
	sandbox = await createAuthSandbox();
});
afterEach(() => sandbox.cleanup());

describe("requestAccess", () => {
	test("a request from this computer reads the session and the memberships once, and decides in memory", async () => {
		const person = await testLocalPerson(sandbox.db);
		const local = testLocalSession(sandbox.auth, sandbox.db, person.userId);
		// The first request finds the local session.
		await testRequestAccess(sandbox.auth, sandbox.db, new Headers(), local);

		const statements = sandbox.countStatements();
		const access = await testRequestAccess(
			sandbox.auth,
			sandbox.db,
			new Headers(),
			local,
		);
		expect(access.spaceId).toBe(person.spaceId);
		expect(await access.can({ run: ["start"] })).toBe(true);
		expect(await access.can({ gate: ["resolve"] }, person.spaceId)).toBe(true);
		// The session and its Person, then the memberships. It was 13.
		expect(statements()).toBe(3);
	});
});

describe("authEndpointAccess", () => {
	test("a request from this computer gets the local cookie without a read of the session", async () => {
		const person = await testLocalPerson(sandbox.db);
		const local = testLocalSession(sandbox.auth, sandbox.db, person.userId);
		await testRequestAccess(sandbox.auth, sandbox.db, new Headers(), local);

		const statements = sandbox.countStatements();
		const { headers, hostAccess } = await testAuthEndpointAccess(
			sandbox.auth,
			sandbox.db,
			new Headers(),
			local,
		);
		expect(statements()).toBe(0);
		expect(hostAccess.allowed).toBe(true);
		const found = await sandbox.auth.api.getSession({ headers });
		expect(found?.user.id).toBe(person.userId);
	});
});
