import type { NotificationSettings } from "../domain/notification-settings";

/**
 * The driven ports of settings. A port of its own has a real adapter,
 * an in-memory adapter and a contract suite in `adapters/out/`.
 */

/** The settings each Person saved. */
export type SettingsStore = {
	/** The settings the Person saved, or null when they saved none. */
	get(personId: string): Promise<NotificationSettings | null>;
	/** Keeps the Person's settings in place of what they had. */
	put(personId: string, settings: NotificationSettings): Promise<void>;
};
