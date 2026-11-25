import { onOff } from "./env-values";
import {
	DEFS,
	type Def,
	SETTING_KEYS,
	type SettingKey,
	type Settings,
} from "./setting-defs";

/**
 * What a setting is read from besides its saved value: the environment,
 * and the defaults that another vertical owns.
 */
export type SettingsGround = {
	/** The fallback of every setting: the daemon's environment. */
	env: Readonly<Record<string, string | undefined>>;
	/** The default embedding model of search by meaning (`knowledge/`). */
	embeddingModel: string;
};

export type SettingSource = "saved" | "env" | "default";

export type SettingField = {
	source: SettingSource;
	default: unknown;
	/** The environment variable this setting falls back to. */
	env?: string;
	/** Its value, when it is set and valid. */
	envValue?: unknown;
	/** Why the setting cannot change here. */
	locked?: string;
};

export type SettingsView = {
	values: Settings;
	fields: Record<SettingKey, SettingField>;
};

/** The saved values, by key. A key without an entry falls back to the environment. */
export type SavedValues = ReadonlyMap<SettingKey, unknown>;

export const SCHEDULER_LOCK =
	"Night Shift was started with schedules turned off. You cannot turn them on here. To turn them on, start Night Shift again with schedules on.";

export const USAGE_LOCK =
	"Night Shift was started with anonymous usage turned off. You cannot turn it on here. Start Night Shift again with usage on.";

/**
 * The saved values of a Device document's `settings` map. An unknown key
 * and a value that does not parse are left out.
 */
export function savedValues(
	entries: Iterable<[string, unknown]>,
): Map<SettingKey, unknown> {
	const out = new Map<SettingKey, unknown>();
	for (const [key, value] of entries) {
		if (!Object.hasOwn(DEFS, key)) continue;
		const parsed = DEFS[key as SettingKey].schema.safeParse(value);
		if (parsed.success) out.set(key as SettingKey, parsed.data);
	}
	return out;
}

/** A setting's definition, with the default the ground gives. */
function defOf(key: SettingKey, ground: SettingsGround): Def<unknown> {
	const def: Def<unknown> = DEFS[key];
	return key === "embeddingModel"
		? { ...def, default: ground.embeddingModel }
		: def;
}

/** A setting's default, as the ground gives it. */
export function defaultOf(key: SettingKey, ground: SettingsGround): unknown {
	return defOf(key, ground).default;
}

/** The value of a setting's environment variable, when it is set and valid. */
export function fromEnv(key: SettingKey, ground: SettingsGround): unknown {
	const def = defOf(key, ground);
	if (!def.env || !def.fromEnv) return undefined;
	const raw = ground.env[def.env];
	if (raw === undefined) return undefined;
	const value = def.fromEnv(raw);
	return value !== undefined && def.schema.safeParse(value).success
		? value
		: undefined;
}

function envIs(ground: SettingsGround, name: string, expected: string) {
	return ground.env[name]?.trim().toLowerCase() === expected;
}

function schedulerLocked(ground: SettingsGround): boolean {
	return envIs(ground, "NIGHTSHIFT_SCHEDULER", "off");
}

/** An environment lock forces anonymous usage off for this start. */
function usageLocked(ground: SettingsGround): boolean {
	return (
		envIs(ground, "DO_NOT_TRACK", "1") ||
		envIs(ground, "OTEL_SDK_DISABLED", "true") ||
		onOff(ground.env.NIGHTSHIFT_USAGE ?? "") === false
	);
}

/** One setting: its value and where it comes from. */
export function settingField(
	key: SettingKey,
	saved: SavedValues,
	ground: SettingsGround,
): { value: unknown } & SettingField {
	const def = defOf(key, ground);
	const envValue = fromEnv(key, ground);
	const base = {
		default: def.default,
		...(def.env ? { env: def.env } : {}),
		...(envValue !== undefined ? { envValue } : {}),
	};
	if (key === "scheduler" && schedulerLocked(ground)) {
		return {
			value: false,
			source: "env",
			...base,
			locked: SCHEDULER_LOCK,
		};
	}
	if (key === "usage" && usageLocked(ground)) {
		return {
			value: false,
			source: "env",
			...base,
			locked: USAGE_LOCK,
		};
	}
	if (saved.has(key))
		return { value: saved.get(key), source: "saved", ...base };
	if (envValue !== undefined)
		return { value: envValue, source: "env", ...base };
	return { value: def.default, source: "default", ...base };
}

/** Every setting's value: saved, else the environment, else the default. */
export function currentSettings(
	saved: SavedValues,
	ground: SettingsGround,
): Settings {
	return Object.fromEntries(
		SETTING_KEYS.map((key) => [key, settingField(key, saved, ground).value]),
	) as Settings;
}

/** The values and where each one comes from, as the Settings page shows them. */
export function settingsView(
	saved: SavedValues,
	ground: SettingsGround,
): SettingsView {
	const fields = {} as Record<SettingKey, SettingField>;
	for (const key of SETTING_KEYS) {
		const { value: _value, ...rest } = settingField(key, saved, ground);
		fields[key] = rest;
	}
	return { values: currentSettings(saved, ground), fields };
}
