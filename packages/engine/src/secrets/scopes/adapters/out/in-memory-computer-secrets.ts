import type { ComputerSecrets } from "../../application/ports";

/** This computer's keychain in memory, for the use-case tests. */
export function inMemoryComputerSecrets(
	initial: Iterable<[string, string]> = [],
) {
	const values = new Map<string, string>(initial);
	const twin = {
		get: async (name: string) => values.get(name) ?? null,
		async set(name: string, value: string) {
			values.set(name, value);
		},
		async delete(name: string) {
			values.delete(name);
		},
		/** The values held now: a test reads them to see what was saved. */
		values,
	};
	return twin satisfies ComputerSecrets;
}
