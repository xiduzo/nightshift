import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { session } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";

import { createLocalSession } from "../local-session";
import { localPerson } from "../spaces";
import { type AuthSandbox, createAuthSandbox } from "../testing/sandbox";
import { authEndpointAccess, requestAccess } from "./request";

/** The access of one request: read once, decided in memory. */

let sandbox: AuthSandbox;
beforeEach(async () => {
	sandbox = await createAuthSandbox();
});
afterEach(() => sandbox.cleanup());

async function sharedSpace(headers: Headers): Promise<string> {
	const space = await sandbox.auth.api.createOrganization({
		headers,
		body: { name: "Platform", slug: "platform" },
	});
	if (!space) throw new Error("no space");
	return space.id;
}

describe("requestAccess", () => {
	test("a request from this computer reads the session and the memberships once, and decides in memory", async () => {
		const person = await localPerson(sandbox.db);
		const local = createLocalSession(sandbox.auth, sandbox.db, person.userId);
		// The first request finds the local session.
		await requestAccess(sandbox.auth, sandbox.db, new Headers(), local);

		const statements = sandbox.countStatements();
		const access = await requestAccess(
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

	test("a role decides in each Space of the Person, and no Space of another", async () => {
		const ada = await sandbox.signUp("Ada");
		const bob = await sandbox.signUp("Bob");
		const platform = await sharedSpace(ada.headers);
		await sandbox.auth.api.addMember({
			body: { userId: bob.userId, role: "viewer", organizationId: platform },
		});
		const access = await requestAccess(
			sandbox.auth,
			sandbox.db,
			bob.headers,
			null,
		);
		expect(await access.can({ run: ["start"] })).toBe(true);
		expect(await access.can({ run: ["start"] }, platform)).toBe(false);
		expect(await access.can({ project: ["move"] }, "space-of-nobody")).toBe(
			false,
		);
		const carol = await sandbox.signUp("Carol");
		const outsider = await requestAccess(
			sandbox.auth,
			sandbox.db,
			carol.headers,
			null,
		);
		expect(await outsider.can({ run: ["start"] }, platform)).toBe(false);
	});

	test("a Space made through the request is the Person's at once", async () => {
		const ada = await sandbox.signUp("Ada");
		const access = await requestAccess(
			sandbox.auth,
			sandbox.db,
			ada.headers,
			null,
		);
		const { id } = await access.createSpace("Platform");
		expect(await access.can({ space: ["delete"] }, id)).toBe(true);
	});

	test("the local session gives way to a new one when it ends", async () => {
		const person = await localPerson(sandbox.db);
		const local = createLocalSession(sandbox.auth, sandbox.db, person.userId);
		const first = await requestAccess(
			sandbox.auth,
			sandbox.db,
			new Headers(),
			local,
		);
		// Signed out everywhere.
		await sandbox.db.delete(session).where(eq(session.userId, person.userId));
		const after = await requestAccess(
			sandbox.auth,
			sandbox.db,
			new Headers(),
			local,
		);
		expect(after.session?.user.id).toBe(person.userId);
		expect(after.session?.session.id).not.toBe(first.session?.session.id);
	});
});

describe("authEndpointAccess", () => {
	test("a request from this computer gets the local cookie without a read of the session", async () => {
		const person = await localPerson(sandbox.db);
		const local = createLocalSession(sandbox.auth, sandbox.db, person.userId);
		await requestAccess(sandbox.auth, sandbox.db, new Headers(), local);

		const statements = sandbox.countStatements();
		const { headers, hostAccess } = await authEndpointAccess(
			sandbox.auth,
			new Headers(),
			local,
		);
		expect(statements()).toBe(0);
		expect(hostAccess.allowed).toBe(true);
		const found = await sandbox.auth.api.getSession({ headers });
		expect(found?.user.id).toBe(person.userId);
	});
});
