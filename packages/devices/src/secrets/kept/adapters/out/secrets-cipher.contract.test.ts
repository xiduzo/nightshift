import { describe, expect, test } from "bun:test";
import { secretsCipherContract } from "./secrets-cipher.contract";
import { webcryptoSecretsCipher } from "./webcrypto-secrets-cipher";

/** The contract of `SecretsCipher`. No use case reads the port, so it has no twin. */

secretsCipherContract("over WebCrypto", async () => ({
	secretsCipher: webcryptoSecretsCipher(
		"a-secrets-key-for-these-tests-0123456789",
	),
}));

describe("WebCrypto", () => {
	const KEY = "a-secrets-key-for-these-tests-0123456789";

	test("a value does not open for another name or with another key", async () => {
		const sealed = await webcryptoSecretsCipher(KEY).seal("v", "ann\nTOKEN");
		await expect(
			webcryptoSecretsCipher(KEY).open(sealed, "ann\nOTHER"),
		).rejects.toThrow();
		await expect(
			webcryptoSecretsCipher(`${KEY}-other`).open(sealed, "ann\nTOKEN"),
		).rejects.toThrow();
	});

	test("a key shorter than 32 characters is refused", () => {
		expect(() => webcryptoSecretsCipher("short")).toThrow("too short");
	});
});
