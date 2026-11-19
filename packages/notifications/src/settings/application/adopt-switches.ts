import {
	applyPatch,
	type ComputerSwitches,
	defaultSettings,
	eventsOfSwitches,
	notificationSettingsPatchSchema,
	switchesChanged,
} from "../domain/notification-settings";
import type { SettingsStore } from "./ports";

export type AdoptSwitchesPorts = {
	settingsStore: Pick<SettingsStore, "get" | "put">;
	/** The time zone of a Person who saved no settings. */
	timeZone: string;
};

/** The Person, what a save of the computer's settings sent, and the switches after it. */
export type AdoptSwitches = {
	personId: string;
	patch: Partial<Record<keyof ComputerSwitches, unknown>>;
	switches: ComputerSwitches;
};

/**
 * After a save of the computer's settings that changed one of its three
 * switches: the Person's events take the switches' values, for a client
 * that still sends them. A save without them changes nothing. Night Shift
 * asks, after the computer's settings change.
 */
export const adoptSwitches =
	(ports: AdoptSwitchesPorts) =>
	async (request: AdoptSwitches): Promise<void> => {
		if (!switchesChanged(request.patch)) return;
		const patch = notificationSettingsPatchSchema.parse({
			events: eventsOfSwitches(request.switches),
		});
		const current =
			(await ports.settingsStore.get(request.personId)) ??
			defaultSettings(ports.timeZone);
		const next = applyPatch(current, patch);
		await ports.settingsStore.put(request.personId, next);
	};
