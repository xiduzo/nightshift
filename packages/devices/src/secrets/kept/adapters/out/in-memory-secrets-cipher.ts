import type { SecretsCipher } from "../../application/ports";
import type { Sealed } from "../../domain/kept-secret";

/**
 * A cipher for tests: each seal is a new handle to the value in memory,
 * so no value shows in what it gives. Opens only with the same bound.
 */
export function inMemorySecretsCipher() {
	const kept = new Map<string, { value: string; bound: string }>();
	let count = 0;
	const twin = {
		async seal(value: string, bound: string): Promise<Sealed> {
			count += 1;
			const ciphertext = `sealed-${count}`;
			kept.set(ciphertext, { value, bound });
			return { ciphertext, iv: `iv-${count}` };
		},
		async open(sealed: Sealed, bound: string): Promise<string> {
			const found = kept.get(sealed.ciphertext);
			if (!found || found.bound !== bound) {
				throw new Error("The value does not open.");
			}
			return found.value;
		},
	};
	return twin satisfies SecretsCipher;
}
