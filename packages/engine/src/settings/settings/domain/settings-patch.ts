import { Refusal } from "@nightshift/refusal";
import {
	SETTING_KEYS,
	type SettingKey,
	type SettingsPatch,
	settingsPatchSchema,
} from "./setting-defs";
import {
	currentSettings,
	defaultOf,
	fromEnv,
	type SavedValues,
	type SettingsGround,
} from "./setting-fields";

/** The words of a save whose first usage-limit wait is longer than the longest one. */
export const FIRST_WAIT_TOO_LONG =
	"The first usage-limit wait cannot be longer than the longest one.";

/** One write of the saved values: what to save, then what to forget. */
export type SettingsWrite = {
	/** Key and value, in the order of the settings. The same key twice: the last one counts. */
	set: [SettingKey, unknown][];
	/** The keys whose saved value goes: back to the environment, then the default. */
	forget: SettingKey[];
};

/**
 * What a save writes. The patch must parse (`settingsPatchSchema`): a
 * value saves it, null forgets it. The first usage-limit wait may not be
 * longer than the longest one, as they are after the save. Saving the
 * usage switch, on or off, means the person has seen it (`usageSeen`).
 */
export function planSettingsSave(
	patch: SettingsPatch,
	saved: SavedValues,
	ground: SettingsGround,
): SettingsWrite {
	const parsed = settingsPatchSchema.parse(patch);
	// The value after the patch: null goes back to the environment, then the default.
	const after = (key: SettingKey) => {
		const value = parsed[key];
		if (value === undefined) return currentSettings(saved, ground)[key];
		if (value === null) return fromEnv(key, ground) ?? defaultOf(key, ground);
		return value;
	};
	const waits = {
		first: after("usageLimitFirstWaitMinutes") as number,
		max: after("usageLimitMaxWaitMinutes") as number,
	};
	if (waits.first > waits.max) {
		throw new Refusal("invalid", FIRST_WAIT_TOO_LONG);
	}
	const write: SettingsWrite = { set: [], forget: [] };
	for (const key of SETTING_KEYS) {
		const value = parsed[key];
		if (value === null) write.forget.push(key);
		else if (value !== undefined) write.set.push([key, value]);
	}
	// Saving the switch, on or off, means the person has seen it.
	if (typeof parsed.usage === "boolean") write.set.push(["usageSeen", true]);
	return write;
}
