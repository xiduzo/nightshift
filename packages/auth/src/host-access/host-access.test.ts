import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { requestAccess } from "../access";
import { createLocalSession } from "../local-session";
import { localPerson } from "../spaces";
import { type AuthSandbox, createAuthSandbox } from "../testing/sandbox";
import { turnOnTwoFactor } from "../testing/two-factor";

const REQUIRED = { requireTwoFactor: true };

describe("requestAccess on a Host that requires two-factor", () => {
	let sandbox: AuthSandbox;
	beforeEach(async () => {
		sandbox = await createAuthSandbox();
	});
	afterEach(() => sandbox.cleanup());

	test("a session from another computer is refused until its Person turns two-factor on", async () => {
		const ada = await sandbox.signUp("Ada");
		const before = await requestAccess(
			sandbox.auth,
			sandbox.db,
			ada.headers,
			null,
			REQUIRED,
		);
		expect(before.session?.user.id).toBe(ada.userId);
		expect(before.hostAccess.allowed).toBe(false);

		const { headers } = await turnOnTwoFactor(sandbox.auth, ada.headers);
		const after = await requestAccess(
			sandbox.auth,
			sandbox.db,
			headers,
			null,
			REQUIRED,
		);
		expect(after.hostAccess.allowed).toBe(true);
	});

	test("the local session of this computer is not affected", async () => {
		const person = await localPerson(sandbox.db);
		const local = createLocalSession(sandbox.auth, sandbox.db, person.userId);
		const access = await requestAccess(
			sandbox.auth,
			sandbox.db,
			new Headers(),
			local,
			REQUIRED,
		);
		expect(access.session?.user.id).toBe(person.userId);
		expect(access.hostAccess.allowed).toBe(true);
	});

	test("without the requirement, nothing changes", async () => {
		const ada = await sandbox.signUp("Ada");
		const access = await requestAccess(
			sandbox.auth,
			sandbox.db,
			ada.headers,
			null,
		);
		expect(access.hostAccess.allowed).toBe(true);
	});
});
