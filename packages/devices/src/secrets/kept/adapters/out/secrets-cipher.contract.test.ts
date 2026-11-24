import { describe, expect, test } from "bun:test";
import { inMemorySecretsCipher } from "./in-memory-secrets-cipher";
import { secretsCipherContract } from "./secrets-cipher.contract";
import { webcryptoSecretsCipher } from "./webcrypto-secrets-cipher";

/** The contract of `SecretsCipher`, on both adapters. */

secretsCipherContract("in memory", async () => ({
	secretsCipher: inMemorySecretsCipher(),
}));

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
