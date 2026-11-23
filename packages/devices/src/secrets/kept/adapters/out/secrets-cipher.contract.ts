import { describe, expect, test } from "bun:test";
import type { SecretsCipher } from "../../application/ports";

/** One adapter of `SecretsCipher` to test. */
export type SecretsCipherUnderTest = { secretsCipher: SecretsCipher };

/** A value of these tests. It looks like no real secret. */
const VALUE = "not-a-real-value";

/**
 * What every adapter of `SecretsCipher` does.
 * `secrets-cipher.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function secretsCipherContract(
	name: string,
	make: () => Promise<SecretsCipherUnderTest>,
): void {
	describe(`SecretsCipher contract: ${name}`, () => {
		test("a sealed value opens with the bound it was sealed with", async () => {
			const { secretsCipher } = await make();
			const sealed = await secretsCipher.seal(VALUE, "person-ada\nTOKEN");
			expect(await secretsCipher.open(sealed, "person-ada\nTOKEN")).toBe(VALUE);
		});

		test("the value never shows in what is kept", async () => {
			const { secretsCipher } = await make();
			const sealed = await secretsCipher.seal(VALUE, "person-ada\nTOKEN");
			expect(JSON.stringify(sealed)).not.toContain(VALUE);
		});

		test("each seal is new, for the same value", async () => {
			const { secretsCipher } = await make();
			const first = await secretsCipher.seal(VALUE, "person-ada\nTOKEN");
			const second = await secretsCipher.seal(VALUE, "person-ada\nTOKEN");
			expect(second.iv).not.toBe(first.iv);
			expect(second.ciphertext).not.toBe(first.ciphertext);
		});

		test("a value does not open with another bound", async () => {
			const { secretsCipher } = await make();
			const sealed = await secretsCipher.seal(VALUE, "person-ada\nTOKEN");
			await expect(
				secretsCipher.open(sealed, "person-bob\nTOKEN"),
			).rejects.toThrow();
		});
	});
}
