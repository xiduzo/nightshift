import type { SavedSettings } from "../../application/ports";
import type { SettingKey } from "../../domain/setting-defs";
import type { SettingsWrite } from "../../domain/settings-patch";

/** The saved settings in memory, for the use-case tests. */
export function inMemorySavedSettings(
	initial: Iterable<[SettingKey, unknown]> = [],
) {
	const values = new Map<SettingKey, unknown>(initial);
	const listeners = new Set<() => void>();
	const writes: SettingsWrite[] = [];
	const twin = {
		read: () => new Map(values),
		async write(plan: SettingsWrite) {
			writes.push(plan);
			for (const key of plan.forget) values.delete(key);
			for (const [key, value] of plan.set) values.set(key, value);
			for (const listener of listeners) listener();
		},
		onChange(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		/** Every write, in order. */
		writes,
	};
	return twin satisfies SavedSettings;
}
