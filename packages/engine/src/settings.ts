import type { Database } from "@nightshift/db";
import { setting } from "@nightshift/db/schema/nightshift";
import {
	type HarnessName,
	harnessNameSchema,
	permissionModeSchema,
	type ResolvedPolicy,
} from "@nightshift/flows";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

/**
 * The daemon's settings. Each one is changed in the UI and saved in the
 * database; a setting with no saved value falls back to the daemon's
 * environment, then to its default. One exception: `NIGHTSHIFT_SCHEDULER=off`
 * locks the scheduler off, so a dev daemon on a copy of the database never
 * starts the night's schedules.
 */

type Def<T> = {
	schema: z.ZodType<T>;
	default: T;
	/** The environment variable that is the fallback. */
	env?: string;
	/** Reads the variable. Undefined when it does not make a valid value. */
	fromEnv?: (raw: string) => T | undefined;
};

const int = (raw: string) => {
	const n = Number(raw.trim());
	return Number.isInteger(n) ? n : undefined;
};
const text = (raw: string) => (raw.trim() === "" ? undefined : raw.trim());

const onOff = (raw: string) => {
	const value = raw.trim().toLowerCase();
	if (["on", "true", "1"].includes(value)) return true;
	if (["off", "false", "0"].includes(value)) return false;
	return undefined;
};

const positiveMinutes = z.number().positive().max(10_080);

const DEFS = {
	scheduler: {
		schema: z.boolean(),
		default: true,
		env: "NIGHTSHIFT_SCHEDULER",
		fromEnv: (raw: string) => raw.trim().toLowerCase() !== "off",
	} satisfies Def<boolean>,
	maxConcurrentRuns: {
		schema: z.number().int().min(1).max(16),
		default: 2,
		env: "NIGHTSHIFT_MAX_CONCURRENT_RUNS",
		fromEnv: int,
	} satisfies Def<number>,
	maxStepsPerRun: {
		schema: z.number().int().min(1).max(100_000),
		default: 500,
		env: "NIGHTSHIFT_MAX_STEPS_PER_RUN",
		fromEnv: int,
	} satisfies Def<number>,
	usageLimitFirstWaitMinutes: {
		schema: positiveMinutes,
		default: 5,
	} satisfies Def<number>,
	usageLimitMaxWaitMinutes: {
		schema: positiveMinutes,
		default: 60,
	} satisfies Def<number>,
	networkGraceMinutes: {
		schema: positiveMinutes,
		default: 240,
	} satisfies Def<number>,
	resumeInterruptedRuns: {
		schema: z.boolean(),
		default: true,
		env: "NIGHTSHIFT_RESUME_INTERRUPTED_RUNS",
		fromEnv: onOff,
	} satisfies Def<boolean>,
	claudeBin: {
		schema: z.string().trim().min(1),
		default: "claude",
		env: "NIGHTSHIFT_CLAUDE_BIN",
		fromEnv: text,
	} satisfies Def<string>,
	opencodeBin: {
		schema: z.string().trim().min(1),
		default: "opencode",
		env: "NIGHTSHIFT_OPENCODE_BIN",
		fromEnv: text,
	} satisfies Def<string>,
	codexBin: {
		schema: z.string().trim().min(1),
		default: "codex",
		env: "NIGHTSHIFT_CODEX_BIN",
		fromEnv: text,
	} satisfies Def<string>,
	/** The harnesses added on the Agents page. Agent nodes may run only on these. */
	harnesses: {
		schema: z.array(harnessNameSchema).max(harnessNameSchema.options.length),
		default: [...harnessNameSchema.options],
	} satisfies Def<HarnessName[]>,
	agentHarness: {
		schema: harnessNameSchema,
		default: "claude-code",
	} satisfies Def<HarnessName>,
	agentModel: {
		schema: z.string().trim().min(1),
		default: "sonnet",
	} satisfies Def<string>,
	agentPermissionMode: {
		schema: permissionModeSchema,
		default: "acceptEdits",
	} satisfies Def<z.infer<typeof permissionModeSchema>>,
	decisionModel: {
		schema: z.string().trim().min(1),
		default: "haiku",
	} satisfies Def<string>,
	notifyGateOpened: {
		schema: z.boolean(),
		default: true,
	} satisfies Def<boolean>,
	notifyRunFinished: {
		schema: z.boolean(),
		default: true,
	} satisfies Def<boolean>,
	notifyRunFailed: {
		schema: z.boolean(),
		default: true,
	} satisfies Def<boolean>,
};

type Defs = typeof DEFS;
export type SettingKey = keyof Defs;
/** From each schema, not the default: a default's literal type (`true`, "claude-code") would be too narrow. */
export type Settings = { [K in SettingKey]: z.output<Defs[K]["schema"]> };

export const SETTING_KEYS = Object.keys(DEFS) as SettingKey[];

/** A change: a value saves it, null forgets the saved value (back to the environment, then the default). */
export const settingsPatchSchema = z
	.object(
		Object.fromEntries(
			SETTING_KEYS.map((key) => [key, DEFS[key].schema.nullable().optional()]),
		) as { [K in SettingKey]: z.ZodOptional<z.ZodNullable<Defs[K]["schema"]>> },
	)
	.strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

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

/** The settings the engine reads when they apply. */
export type RunSettings = Pick<
	Settings,
	| "scheduler"
	| "maxConcurrentRuns"
	| "maxStepsPerRun"
	| "resumeInterruptedRuns"
	| "decisionModel"
> & { policy: Omit<ResolvedPolicy, "maxSteps" | "resumeInterruptedRuns"> };

export type SettingsStore = {
	/** Reads the saved values. Call once before `current`. */
	load(): Promise<void>;
	current(): Settings;
	view(): SettingsView;
	save(patch: SettingsPatch): Promise<SettingsView>;
	/** The engine's part of the settings. */
	run(): RunSettings;
};

const SCHEDULER_LOCK =
	"Night Shift was started with schedules turned off, so you cannot turn them on here. To use schedules, restart Night Shift without this setting.";

export function createSettingsStore(options: {
	db: Database;
	env: Readonly<Record<string, string | undefined>>;
}): SettingsStore {
	const { db, env } = options;
	const saved = new Map<SettingKey, unknown>();

	function fromEnv(key: SettingKey): unknown {
		const def: Def<unknown> = DEFS[key];
		if (!def.env || !def.fromEnv) return undefined;
		const raw = env[def.env];
		if (raw === undefined) return undefined;
		const value = def.fromEnv(raw);
		return value !== undefined && def.schema.safeParse(value).success
			? value
			: undefined;
	}

	function schedulerLocked(): boolean {
		return env.NIGHTSHIFT_SCHEDULER?.trim().toLowerCase() === "off";
	}

	function field(key: SettingKey): { value: unknown } & SettingField {
		const def: Def<unknown> = DEFS[key];
		const envValue = fromEnv(key);
		const base = {
			default: def.default,
			...(def.env ? { env: def.env } : {}),
			...(envValue !== undefined ? { envValue } : {}),
		};
		if (key === "scheduler" && schedulerLocked()) {
			return {
				value: false,
				source: "env",
				...base,
				locked: SCHEDULER_LOCK,
			};
		}
		if (saved.has(key))
			return { value: saved.get(key), source: "saved", ...base };
		if (envValue !== undefined)
			return { value: envValue, source: "env", ...base };
		return { value: def.default, source: "default", ...base };
	}

	function current(): Settings {
		return Object.fromEntries(
			SETTING_KEYS.map((key) => [key, field(key).value]),
		) as Settings;
	}

	function view(): SettingsView {
		const fields = {} as Record<SettingKey, SettingField>;
		for (const key of SETTING_KEYS) {
			const { value: _value, ...rest } = field(key);
			fields[key] = rest;
		}
		return { values: current(), fields };
	}

	return {
		async load() {
			saved.clear();
			for (const row of await db.select().from(setting)) {
				if (!(row.key in DEFS)) continue;
				const key = row.key as SettingKey;
				try {
					const parsed = DEFS[key].schema.safeParse(JSON.parse(row.value));
					// A value saved by an older build that no longer parses is ignored.
					if (parsed.success) saved.set(key, parsed.data);
				} catch {}
			}
		},
		current,
		view,
		async save(patch) {
			const parsed = settingsPatchSchema.parse(patch);
			// The value after the patch: null goes back to the environment, then the default.
			const after = (key: SettingKey) => {
				const value = parsed[key];
				if (value === undefined) return current()[key];
				if (value === null) return fromEnv(key) ?? DEFS[key].default;
				return value;
			};
			const usage = {
				first: after("usageLimitFirstWaitMinutes") as number,
				max: after("usageLimitMaxWaitMinutes") as number,
			};
			if (usage.first > usage.max) {
				throw new Error(
					"The first usage-limit wait cannot be longer than the longest one.",
				);
			}
			await db.transaction(async (tx) => {
				for (const key of SETTING_KEYS) {
					const value = parsed[key];
					if (value === undefined) continue;
					if (value === null) {
						await tx.delete(setting).where(eq(setting.key, key));
						continue;
					}
					await tx
						.insert(setting)
						.values({ key, value: JSON.stringify(value) })
						.onConflictDoUpdate({
							target: setting.key,
							set: {
								value: JSON.stringify(value),
								updatedAt: sql`(cast(unixepoch('subsecond') * 1000 as integer))`,
							},
						});
				}
			});
			for (const key of SETTING_KEYS) {
				const value = parsed[key];
				if (value === null) saved.delete(key);
				else if (value !== undefined) saved.set(key, value);
			}
			return view();
		},
		run() {
			const s = current();
			return {
				scheduler: s.scheduler,
				maxConcurrentRuns: s.maxConcurrentRuns,
				maxStepsPerRun: s.maxStepsPerRun,
				resumeInterruptedRuns: s.resumeInterruptedRuns,
				decisionModel: s.decisionModel,
				policy: {
					usageLimitFirstWaitMinutes: s.usageLimitFirstWaitMinutes,
					usageLimitMaxWaitMinutes: s.usageLimitMaxWaitMinutes,
					networkGraceMinutes: s.networkGraceMinutes,
				},
			};
		},
	};
}

/** The built-in defaults, for an engine without a settings store. */
export function defaultRunSettings(): RunSettings {
	return {
		scheduler: DEFS.scheduler.default,
		maxConcurrentRuns: DEFS.maxConcurrentRuns.default,
		maxStepsPerRun: DEFS.maxStepsPerRun.default,
		resumeInterruptedRuns: DEFS.resumeInterruptedRuns.default,
		decisionModel: DEFS.decisionModel.default,
		policy: {
			usageLimitFirstWaitMinutes: DEFS.usageLimitFirstWaitMinutes.default,
			usageLimitMaxWaitMinutes: DEFS.usageLimitMaxWaitMinutes.default,
			networkGraceMinutes: DEFS.networkGraceMinutes.default,
		},
	};
}
