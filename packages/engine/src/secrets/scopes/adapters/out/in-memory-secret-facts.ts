import type { SecretFacts } from "../../application/ports";

/** The facts of this computer's secrets in memory, for the use-case tests. */
export function inMemorySecretFacts(
	initial: {
		saved?: Iterable<[string, number | null]>;
		used?: Iterable<[string, number]>;
	} = {},
) {
	let saved = new Map<string, number | null>(initial.saved ?? []);
	let used = new Map<string, number>(initial.used ?? []);
	const listeners = new Set<() => void>();
	/** Every write of the saved names, in order. */
	const writes: { saved: Map<string, number | null>; forget: string[] }[] = [];
	/** Every write of the use times, in order. */
	const uses: Map<string, number>[] = [];
	const twin = {
		saved: () => saved,
		usedAt: () => used,
		async writeSaved(
			next: ReadonlyMap<string, number | null>,
			forget: readonly string[] = [],
		) {
			writes.push({ saved: new Map(next), forget: [...forget] });
			saved = new Map([...next].sort(([a], [b]) => (a < b ? -1 : 1)));
			if (forget.some((name) => used.has(name))) {
				used = new Map(used);
				for (const name of forget) used.delete(name);
			}
			for (const listener of listeners) listener();
		},
		async writeUsed(next: ReadonlyMap<string, number>) {
			uses.push(new Map(next));
			used = new Map(next);
		},
		onSavedChange(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		writes,
		uses,
	};
	return twin satisfies SecretFacts;
}
