/**
 * How a Host keeps a Personal secret at rest (ADR 13, decision 2): AES-GCM
 * with a 256-bit key derived (HKDF-SHA-256) from this computer's secrets
 * key, a new 96-bit nonce per write, and the owner and name as associated
 * data, so a row copied to another owner or name does not open. WebCrypto,
 * as Bun has it: no key leaves this process.
 */

/** A value as it is kept: both in base64. */
export type Sealed = { ciphertext: string; iv: string };

export type SecretsCipher = {
	/** Encrypts `value`, bound to `bound` (who and which name it is). */
	seal(value: string, bound: string): Promise<Sealed>;
	/** The value, when `bound` is the one it was sealed with and the key is the same. Throws otherwise. */
	open(sealed: Sealed, bound: string): Promise<string>;
};

/** The shortest secrets key this computer takes, in characters. */
export const SECRETS_KEY_MIN = 32;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The cipher of a secrets key (`NIGHTSHIFT_SECRETS_KEY`, else the data folder's). */
export function secretsCipher(secret: string): SecretsCipher {
	if (secret.length < SECRETS_KEY_MIN) {
		throw new Error(
			`The secrets key is too short. Use at least ${SECRETS_KEY_MIN} characters.`,
		);
	}
	const key = (async () => {
		const base = await crypto.subtle.importKey(
			"raw",
			encoder.encode(secret),
			"HKDF",
			false,
			["deriveKey"],
		);
		return crypto.subtle.deriveKey(
			{
				name: "HKDF",
				hash: "SHA-256",
				salt: encoder.encode("nightshift"),
				info: encoder.encode("personal secrets v1"),
			},
			base,
			{ name: "AES-GCM", length: 256 },
			false,
			["encrypt", "decrypt"],
		);
	})();

	return {
		async seal(value, bound) {
			const iv = crypto.getRandomValues(new Uint8Array(12));
			const sealed = await crypto.subtle.encrypt(
				{ name: "AES-GCM", iv, additionalData: encoder.encode(bound) },
				await key,
				encoder.encode(value),
			);
			return {
				ciphertext: Buffer.from(sealed).toString("base64"),
				iv: Buffer.from(iv).toString("base64"),
			};
		},
		async open(sealed, bound) {
			const plain = await crypto.subtle.decrypt(
				{
					name: "AES-GCM",
					iv: Buffer.from(sealed.iv, "base64"),
					additionalData: encoder.encode(bound),
				},
				await key,
				Buffer.from(sealed.ciphertext, "base64"),
			);
			return decoder.decode(plain);
		},
	};
}
