import { describe, expect, test } from "bun:test";
import { inMemoryLoginPorts } from "../adapters/out/in-memory-neighbours";
import { setLogin } from "./set-login";

/** The use case setLogin, on in-memory adapters. The twins of `login.test.ts`. */

function ports() {
	const all = inMemoryLoginPorts();
	all.credentials.add({ id: "local", email: "local@this-computer" });
	all.credentials.add({ id: "bob", email: "bob@example.com" });
	return all;
}

describe("setLogin", () => {
	test("this computer's Person gets an email and a password", async () => {
		const all = ports();
		expect(
			await setLogin(all)({
				personId: "local",
				input: {
					email: " Ada@Example.com ",
					password: "a-long-password",
					name: " Ada ",
				},
			}),
		).toEqual({ email: "ada@example.com" });
		expect(all.credentials.records.get("local")).toMatchObject({
			email: "ada@example.com",
			emailVerified: true,
			name: "Ada",
			password: "a-long-password",
		});
	});

	test("setting it again replaces the password", async () => {
		const all = ports();
		const input = { email: "ada@example.com", password: "first-password" };
		await setLogin(all)({ personId: "local", input });
		await setLogin(all)({
			personId: "local",
			input: { ...input, password: "second-password" },
		});
		expect(all.credentials.records.get("local")?.password).toBe(
			"second-password",
		);
	});

	test("refuses another Person's email, a short password, and no email", async () => {
		const all = ports();
		const set = setLogin(all);
		await expect(
			set({
				personId: "local",
				input: { email: "bob@example.com", password: "a-long-password" },
			}),
		).rejects.toThrow("Another Person here signs in with bob@example.com.");
		await expect(
			set({
				personId: "local",
				input: { email: "ada@example.com", password: "short" },
			}),
		).rejects.toThrow("at least 8 characters");
		await expect(
			set({
				personId: "local",
				input: { email: "ada", password: "a-long-password" },
			}),
		).rejects.toThrow("is not an email address");
		expect(all.credentials.calls).toEqual([]);
	});

	test("--reset-two-factor: turns two-factor off and forgets the lost app, before the password", async () => {
		const all = ports();
		all.credentials.add({
			id: "ada",
			email: "ada@example.com",
			twoFactorEnabled: true,
			secondFactor: true,
		});
		await setLogin(all)({
			personId: "ada",
			input: {
				email: "ada@example.com",
				password: "a-new-password",
				resetTwoFactor: true,
			},
		});
		expect(all.credentials.records.get("ada")).toMatchObject({
			twoFactorEnabled: false,
			secondFactor: false,
		});
		expect(all.credentials.calls.map((call) => call.method)).toEqual([
			"updatePerson",
			"forgetSecondFactor",
			"savePassword",
		]);
	});
});
