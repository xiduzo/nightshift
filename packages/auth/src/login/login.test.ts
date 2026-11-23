import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type AuthSandbox, createAuthSandbox } from "../testing";
import { turnOnTwoFactor } from "../testing/two-factor";
import { testLocalPerson, testLogin } from "../testing/wires";

let sandbox: AuthSandbox;
let login: ReturnType<typeof testLogin>;
beforeEach(async () => {
	sandbox = await createAuthSandbox();
	login = testLogin(sandbox.auth, sandbox.db);
});
afterEach(() => sandbox.cleanup());

describe("a login for the Host admin of a Host without a screen", () => {
	test("this computer's Person gets an email and a password, and signs in with them", async () => {
		const local = await testLocalPerson(sandbox.db);
		expect(await login.hasLogin({ personId: local.userId })).toBe(false);
		expect(
			await login.setLogin({
				personId: local.userId,
				input: {
					email: " Ada@Example.com ",
					password: "a-long-password",
					name: "Ada",
				},
			}),
		).toEqual({ email: "ada@example.com" });
		expect(await login.hasLogin({ personId: local.userId })).toBe(true);
		const headers = await sandbox.signIn("ada@example.com", "a-long-password");
		const session = await sandbox.auth.api.getSession({ headers });
		expect(session?.user.id).toBe(local.userId);
		expect(session?.user.name).toBe("Ada");
		expect((session?.user as { role?: string } | undefined)?.role).toBe(
			"admin",
		);
	});

	test("setting it again replaces the password", async () => {
		const local = await testLocalPerson(sandbox.db);
		const creds = { email: "ada@example.com", password: "first-password" };
		await login.setLogin({ personId: local.userId, input: creds });
		await login.setLogin({
			personId: local.userId,
			input: {
				...creds,
				password: "second-password",
			},
		});
		await expect(
			sandbox.signIn("ada@example.com", "first-password"),
		).rejects.toThrow();
		expect(
			await sandbox.signIn("ada@example.com", "second-password"),
		).toBeInstanceOf(Headers);
	});

	test("refuses another Person's email, a short password, and no email", async () => {
		const local = await testLocalPerson(sandbox.db);
		await sandbox.signUp("Bob");
		await expect(
			login.setLogin({
				personId: local.userId,
				input: {
					email: "bob@example.com",
					password: "a-long-password",
				},
			}),
		).rejects.toThrow("Another Person here signs in with bob@example.com.");
		await expect(
			login.setLogin({
				personId: local.userId,
				input: {
					email: "ada@example.com",
					password: "short",
				},
			}),
		).rejects.toThrow("at least 8 characters");
		await expect(
			login.setLogin({
				personId: local.userId,
				input: {
					email: "ada",
					password: "a-long-password",
				},
			}),
		).rejects.toThrow("is not an email address");
	});

	test("--reset-two-factor: a new password signs in without the lost app", async () => {
		const local = await testLocalPerson(sandbox.db);
		const creds = { email: "ada@example.com", password: "a-long-password" };
		await login.setLogin({ personId: local.userId, input: creds });
		await turnOnTwoFactor(
			sandbox.auth,
			await sandbox.signIn(creds.email, creds.password),
		);
		const asked = await sandbox.auth.api.signInEmail({ body: creds });
		expect(asked).toMatchObject({ twoFactorRedirect: true });

		await login.setLogin({
			personId: local.userId,
			input: {
				...creds,
				password: "a-new-password",
				resetTwoFactor: true,
			},
		});
		const headers = await sandbox.signIn(creds.email, "a-new-password");
		const session = await sandbox.auth.api.getSession({ headers });
		expect(session?.user.twoFactorEnabled).toBe(false);
	});
});

describe("ending a session", () => {
	test("signs that screen out, and only the Person's own", async () => {
		const ada = await sandbox.signUp("Ada");
		const bob = await sandbox.signUp("Bob");
		const session = await sandbox.auth.api.getSession({ headers: ada.headers });
		const sessionId = session?.session.id ?? "";

		expect(await login.endSession({ personId: bob.userId, sessionId })).toBe(
			false,
		);
		expect(
			await sandbox.auth.api.getSession({ headers: ada.headers }),
		).not.toBeNull();

		expect(await login.endSession({ personId: ada.userId, sessionId })).toBe(
			true,
		);
		expect(
			await sandbox.auth.api.getSession({ headers: ada.headers }),
		).toBeNull();
	});
});
