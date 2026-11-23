import type { SpaceSecretStore } from "../../application/ports";

/** Secrets of a test in memory, by their Project or Space, then by name. */
export function inMemoryKeptSecrets(now: () => number) {
	const rows = new Map<
		string,
		Map<string, { value: string; setAt: number; setBy: string }>
	>();
	const of = (id: string) => {
		let found = rows.get(id);
		if (!found) {
			found = new Map();
			rows.set(id, found);
		}
		return found;
	};
	return {
		rows,
		async list(id: string) {
			return [...of(id)]
				.sort(([a], [b]) => (a < b ? -1 : 1))
				.map(([name, row]) => ({ name, setAt: row.setAt, setBy: row.setBy }));
		},
		async values(id: string, names?: readonly string[]) {
			const out: Record<string, string> = {};
			for (const [name, row] of of(id)) {
				if (!names || names.includes(name)) out[name] = row.value;
			}
			return out;
		},
		async set(id: string, name: string, value: string, setBy: string) {
			of(id).set(name, { value, setAt: now(), setBy });
		},
		async remove(id: string, name: string) {
			of(id).delete(name);
		},
	};
}

/** The Space secrets of a test, in memory: by Space, then by name. */
export function inMemorySpaceSecretStore(now: () => number) {
	const twin = inMemoryKeptSecrets(now);
	return twin satisfies SpaceSecretStore;
}
