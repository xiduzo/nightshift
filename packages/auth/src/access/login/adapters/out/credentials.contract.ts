import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Credentials } from "../../application/ports";

/** One adapter of `Credentials` to test. */
export type CredentialsUnderTest = {
	credentials: Credentials;
	/** Adds a Person without a password, as the adapter would find them. */
	addPerson(person: { id: string; email: string }): Promise<void>;
	close(): Promise<void>;
};

/**
 * What every adapter of `Credentials` does.
 * `credentials.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function credentialsContract(
	name: string,
	make: () => Promise<CredentialsUnderTest>,
): void {
	describe(`Credentials contract: ${name}`, () => {
		let under: CredentialsUnderTest;
		beforeEach(async () => {
			under = await make();
			await under.addPerson({ id: "ada", email: "ada@example.com" });
		});
		afterEach(async () => {
			await under.close();
		});

		test("finds the Person of an email, and no one for an unknown email", async () => {
			expect(await under.credentials.personOf("ada@example.com")).toBe("ada");
			expect(await under.credentials.personOf("nobody@example.com")).toBeNull();
		});

		test("a Person without a password has none until one is saved", async () => {
			expect(await under.credentials.hasPassword("ada")).toBe(false);
			await under.credentials.savePassword("ada", "a-long-password");
			expect(await under.credentials.hasPassword("ada")).toBe(true);
			await under.credentials.savePassword("ada", "another-password");
			expect(await under.credentials.hasPassword("ada")).toBe(true);
			await under.addPerson({ id: "bob", email: "bob@example.com" });
			expect(await under.credentials.hasPassword("bob")).toBe(false);
		});

		test("a new email takes the place of the old one", async () => {
			await under.credentials.updatePerson("ada", {
				email: "ada@lovelace.dev",
				name: "Ada",
				resetTwoFactor: true,
			});
			expect(await under.credentials.personOf("ada@lovelace.dev")).toBe("ada");
			expect(await under.credentials.personOf("ada@example.com")).toBeNull();
		});

		test("forgets a second factor the Person does not have without an error", async () => {
			await under.credentials.forgetSecondFactor("ada");
			expect(await under.credentials.hasPassword("ada")).toBe(false);
		});
	});
}
