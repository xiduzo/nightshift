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
