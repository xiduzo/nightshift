import type { PersonalSecretStore } from "../../application/ports";

/** The Personal secrets of a test, in memory: by owner, then by name. */
export function inMemoryPersonalSecretStore(now: () => number) {
	const rows = new Map<
		string,
		Map<string, { value: string; setAt: number; setBy: string | null }>
	>();
	const of = (ownerId: string) => {
		let found = rows.get(ownerId);
		if (!found) {
			found = new Map();
			rows.set(ownerId, found);
		}
		return found;
	};
	const twin = {
		rows,
		async list(ownerId: string) {
			return [...of(ownerId)]
				.sort(([a], [b]) => (a < b ? -1 : 1))
				.map(([name, row]) => ({ name, setAt: row.setAt }));
		},
		async values(ownerId: string, names: readonly string[]) {
			const out: Record<string, string> = {};
			for (const name of names) {
				const row = of(ownerId).get(name);
				if (row) out[name] = row.value;
			}
			return out;
		},
		async set(
			ownerId: string,
			name: string,
			value: string,
			setBy: string | null,
		) {
			of(ownerId).set(name, { value, setAt: now(), setBy });
		},
		async remove(ownerId: string, name: string) {
			of(ownerId).delete(name);
		},
	};
	return twin satisfies PersonalSecretStore;
}
