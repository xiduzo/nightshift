import type { SettingsStore } from "../../application/ports";
import type { NotificationSettings } from "../../domain/notification-settings";

/**
 * `SettingsStore` in memory. It keeps a copy of each Person's settings,
 * and records each write (`writes`).
 */
export function inMemorySettingsStore() {
	const saved = new Map<string, NotificationSettings>();
	const twin = {
		/** Every write, in order: `put` or `putIfAbsent`, and for whom. */
		writes: [] as { kind: "put" | "putIfAbsent"; personId: string }[],
		async get(personId: string) {
			const settings = saved.get(personId);
			return settings ? structuredClone(settings) : null;
		},
		async put(personId: string, settings: NotificationSettings) {
			twin.writes.push({ kind: "put", personId });
			saved.set(personId, structuredClone(settings));
		},
		async putIfAbsent(personId: string, settings: NotificationSettings) {
			twin.writes.push({ kind: "putIfAbsent", personId });
			if (!saved.has(personId)) saved.set(personId, structuredClone(settings));
		},
	};
	return twin satisfies SettingsStore;
}

export type InMemorySettingsStore = ReturnType<typeof inMemorySettingsStore>;
