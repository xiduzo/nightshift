import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { hasLogin, setLogin } from "./login";
import { localPerson } from "./spaces";
import { type AuthSandbox, createAuthSandbox } from "./test-support";
import { turnOnTwoFactor } from "./two-factor-support";

let sandbox: AuthSandbox;
beforeEach(async () => {
	sandbox = await createAuthSandbox();
});
afterEach(() => sandbox.cleanup());

describe("a login for the Host admin of a Host without a screen", () => {
	test("this computer's Person gets an email and a password, and signs in with them", async () => {
		const local = await localPerson(sandbox.db);
		expect(await hasLogin(sandbox.db, local.userId)).toBe(false);
		expect(
			await setLogin(sandbox.auth, local.userId, {
				email: " Ada@Example.com ",
				password: "a-long-password",
				name: "Ada",
			}),
		).toEqual({ email: "ada@example.com" });
		expect(await hasLogin(sandbox.db, local.userId)).toBe(true);
		const headers = await sandbox.signIn("ada@example.com", "a-long-password");
		const session = await sandbox.auth.api.getSession({ headers });
		expect(session?.user.id).toBe(local.userId);
		expect(session?.user.name).toBe("Ada");
		expect((session?.user as { role?: string } | undefined)?.role).toBe(
			"admin",
		);
	});

	test("setting it again replaces the password", async () => {
		const local = await localPerson(sandbox.db);
		const login = { email: "ada@example.com", password: "first-password" };
		await setLogin(sandbox.auth, local.userId, login);
		await setLogin(sandbox.auth, local.userId, {
			...login,
			password: "second-password",
		});
		await expect(
			sandbox.signIn("ada@example.com", "first-password"),
		).rejects.toThrow();
		expect(
			await sandbox.signIn("ada@example.com", "second-password"),
		).toBeInstanceOf(Headers);
	});

	test("refuses another Person's email, a short password, and no email", async () => {
		const local = await localPerson(sandbox.db);
		await sandbox.signUp("Bob");
		await expect(
			setLogin(sandbox.auth, local.userId, {
				email: "bob@example.com",
				password: "a-long-password",
			}),
		).rejects.toThrow("Another Person here signs in with bob@example.com.");
		await expect(
			setLogin(sandbox.auth, local.userId, {
				email: "ada@example.com",
				password: "short",
			}),
		).rejects.toThrow("at least 8 characters");
		await expect(
			setLogin(sandbox.auth, local.userId, {
				email: "ada",
				password: "a-long-password",
			}),
		).rejects.toThrow("is not an email address");
	});

	test("--reset-two-factor: a new password signs in without the lost app", async () => {
		const local = await localPerson(sandbox.db);
		const login = { email: "ada@example.com", password: "a-long-password" };
		await setLogin(sandbox.auth, local.userId, login);
		await turnOnTwoFactor(
			sandbox.auth,
			await sandbox.signIn(login.email, login.password),
		);
		const asked = await sandbox.auth.api.signInEmail({ body: login });
		expect(asked).toMatchObject({ twoFactorRedirect: true });

		await setLogin(sandbox.auth, local.userId, {
			...login,
			password: "a-new-password",
			resetTwoFactor: true,
		});
		const headers = await sandbox.signIn(login.email, "a-new-password");
		const session = await sandbox.auth.api.getSession({ headers });
		expect(session?.user.twoFactorEnabled).toBe(false);
	});
});
