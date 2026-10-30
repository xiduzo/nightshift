import {
	type CustomAgent,
	customAgentSchema,
	DEFAULT_POLICY,
	type DeciderName,
	deciderNameSchema,
	HARNESS_CATALOG,
	type HarnessName,
	harnessNameSchema,
	permissionModeSchema,
	type ResolvedPolicy,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { z } from "zod";

import { type DeviceDocument, mapView } from "./device-document";

/**
 * The daemon's settings. Each one is changed in the UI and saved in this
 * Device's document; a setting with no saved value falls back to the
 * daemon's environment, then to its default. One exception: `NIGHTSHIFT_SCHEDULER=off`
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

/**
 * A Host's address: an `https://` origin. A loopback `http://` one is
 * allowed too, for tests and local development: it never leaves the
 * computer.
 */
export const hostAddressSchema = z
	.string()
	.trim()
	.refine(isHostAddress, {
		message: "Use an https:// address, for example https://studio.example.com.",
	})
	.transform((value) => new URL(value).origin);

export function isHostAddress(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.protocol === "https:") return true;
	return url.protocol === "http:" && isLoopbackHost(url.hostname);
}

/** `localhost`, `127.x.x.x` or `[::1]`. */
export function isLoopbackHost(hostname: string): boolean {
	return (
		hostname === "localhost" ||
		hostname === "[::1]" ||
		hostname === "::1" ||
		/^127\.\d+\.\d+\.\d+$/.test(hostname)
	);
}

const list = (raw: string) => {
	const items = raw
		.split(/[\s,]+/)
		.map((item) => item.trim())
		.filter(Boolean);
	return items.length > 0 ? items : undefined;
};

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
		default: DEFAULT_POLICY.maxSteps,
		env: "NIGHTSHIFT_MAX_STEPS_PER_RUN",
		fromEnv: int,
	} satisfies Def<number>,
	usageLimitFirstWaitMinutes: {
		schema: positiveMinutes,
		default: DEFAULT_POLICY.usageLimitFirstWaitMinutes,
	} satisfies Def<number>,
	usageLimitMaxWaitMinutes: {
		schema: positiveMinutes,
		default: DEFAULT_POLICY.usageLimitMaxWaitMinutes,
	} satisfies Def<number>,
	networkGraceMinutes: {
		schema: positiveMinutes,
		default: DEFAULT_POLICY.networkGraceMinutes,
	} satisfies Def<number>,
	/** The most a run may spend, in USD, unless its flow sets its own. Null: no budget. */
	budgetUsd: {
		schema: z.number().positive().max(100_000).nullable(),
		default: DEFAULT_POLICY.budgetUsd,
	} satisfies Def<number | null>,
	/** The most turns one Agent session may take, unless the flow or the node sets its own. Null: no limit. */
	maxTurns: {
		schema: z.number().int().min(1).max(100_000).nullable(),
		default: DEFAULT_POLICY.maxTurns,
	} satisfies Def<number | null>,
	/** An Agent step with no activity for this long ends `fail`, unless the flow or the node sets its own. */
	idleMinutes: {
		schema: positiveMinutes,
		default: DEFAULT_POLICY.idleMinutes,
	} satisfies Def<number>,
	resumeInterruptedRuns: {
		schema: z.boolean(),
		default: DEFAULT_POLICY.resumeInterruptedRuns,
		env: "NIGHTSHIFT_RESUME_INTERRUPTED_RUNS",
		fromEnv: onOff,
	} satisfies Def<boolean>,
	/**
	 * The cleanup of run worktrees and branches on this computer: an ended
	 * run's worktree and local branches go once the run is
	 * `cleanUpAfterDays` old, and only when its work is merged or pushed
	 * and nothing is left uncommitted (`cleanup/`).
	 */
	cleanUpRuns: {
		schema: z.boolean(),
		default: true,
		env: "NIGHTSHIFT_CLEAN_UP_RUNS",
		fromEnv: onOff,
	} satisfies Def<boolean>,
	// 90 days keeps every run that the overviews and their graphs look back on.
	cleanUpAfterDays: {
		schema: z.number().int().min(1).max(365),
		default: 90,
	} satisfies Def<number>,
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
	grokBin: {
		schema: z.string().trim().min(1),
		default: "grok",
		env: "NIGHTSHIFT_GROK_BIN",
		fromEnv: text,
	} satisfies Def<string>,
	copilotBin: {
		schema: z.string().trim().min(1),
		default: "copilot",
		env: "NIGHTSHIFT_COPILOT_BIN",
		fromEnv: text,
	} satisfies Def<string>,
	geminiBin: {
		schema: z.string().trim().min(1),
		default: "gemini",
		env: "NIGHTSHIFT_GEMINI_BIN",
		fromEnv: text,
	} satisfies Def<string>,
	cursorBin: {
		schema: z.string().trim().min(1),
		default: "agent",
		env: "NIGHTSHIFT_CURSOR_BIN",
		fromEnv: text,
	} satisfies Def<string>,
	piBin: {
		schema: z.string().trim().min(1),
		default: "pi",
		env: "NIGHTSHIFT_PI_BIN",
		fromEnv: text,
	} satisfies Def<string>,
	/**
	 * The harnesses added on the Agents page. Agent nodes may run only on
	 * these. The default is the harnesses Night Shift had before Grok Build
	 * and the ACP agents, so an install with no saved list keeps them.
	 */
	harnesses: {
		schema: z.array(harnessNameSchema).max(harnessNameSchema.options.length),
		default: ["claude-code", "opencode", "codex"],
	} satisfies Def<HarnessName[]>,
	/**
	 * The custom agents added on the Agents page: any coding agent that
	 * speaks the Agent Client Protocol, with the command that starts it.
	 * Agent nodes name one as `acp:<slug>`.
	 */
	customAgents: {
		schema: z
			.array(customAgentSchema)
			.max(32)
			.refine(
				(agents) => new Set(agents.map((a) => a.slug)).size === agents.length,
				{ message: "Each custom agent needs its own name in flows." },
			),
		default: [],
	} satisfies Def<CustomAgent[]>,
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
	/**
	 * The Agent Profile the assistant runs on when a request names none.
	 * Empty: the first profile whose harness is on this computer.
	 */
	assistantProfile: {
		schema: z.string().trim().max(100),
		default: "",
	} satisfies Def<string>,
	/** New Decision nodes start on this decider. */
	decisionDecider: {
		schema: deciderNameSchema,
		default: "typesafe",
	} satisfies Def<DeciderName>,
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
	/**
	 * "Keep this computer awake": the daemon holds
	 * the OS's sleep lock while a run on this computer runs or sleeps until
	 * its timer. A setting of the computer, not of a Person: the computer
	 * sleeps, and a laptop and a desktop of one person want different
	 * answers.
	 */
	keepAwake: {
		schema: z.boolean(),
		default: false,
		env: "NIGHTSHIFT_KEEP_AWAKE",
		fromEnv: onOff,
	} satisfies Def<boolean>,
	/**
	 * "Be a Host": this computer lets other Devices pair with it and keeps
	 * their documents. Off: it accepts no Device at all.
	 */
	host: {
		schema: z.boolean(),
		default: false,
		env: "NIGHTSHIFT_HOST",
		fromEnv: onOff,
	} satisfies Def<boolean>,
	/**
	 * "Copy every project": a Host copies each project of its Spaces that
	 * has a GitHub remote and no Clone on it yet (`ProjectCopies`). Only a
	 * Host does: it runs every schedule.
	 */
	copyProjects: {
		schema: z.boolean(),
		default: true,
		env: "NIGHTSHIFT_COPY_PROJECTS",
		fromEnv: onOff,
	} satisfies Def<boolean>,
	/**
	 * A Host's addresses, in the order a Device tries them: a LAN name, a
	 * tailnet name, a public name. A Host listens beyond this computer only
	 * when one of them is `https://`.
	 */
	hostAddresses: {
		schema: z.array(hostAddressSchema).max(8),
		default: [],
		env: "NIGHTSHIFT_HOST_ADDRESSES",
		fromEnv: list,
	} satisfies Def<string[]>,
	/**
	 * How long a session this computer runs for a run that another Device
	 * walks goes on while its replies cannot reach the Host. Then it
	 * stops: nothing runs here for a Walker that is gone. The runs this
	 * computer walks itself go on offline: the exchange sends them later.
	 */
	offlineWorkMinutes: {
		schema: positiveMinutes,
		default: 10,
	} satisfies Def<number>,
	/** A Device key that goes this many days without use expires. */
	deviceKeyIdleDays: {
		schema: z.number().int().min(1).max(365),
		default: 30,
	} satisfies Def<number>,
};

type Defs = typeof DEFS;
export type SettingKey = keyof Defs;
/** From each schema, not the default: a default's literal type (`true`, "claude-code") would be too narrow. */
export type Settings = { [K in SettingKey]: z.output<Defs[K]["schema"]> };

export const SETTING_KEYS = Object.keys(DEFS) as SettingKey[];

/** Every setting's value, as `current()` returns them: the API's output schema. */
export const settingsSchema = z.object(
	Object.fromEntries(SETTING_KEYS.map((key) => [key, DEFS[key].schema])) as {
		[K in SettingKey]: Defs[K]["schema"];
	},
);

/** The setting that holds each harness's executable (`binSetting` of `HARNESS_CATALOG`). */
export const HARNESS_BIN = Object.fromEntries(
	harnessNameSchema.options.map((name) => [
		name,
		HARNESS_CATALOG[name].binSetting,
	]),
) as {
	[K in HarnessName]: (typeof HARNESS_CATALOG)[K]["binSetting"];
} satisfies Record<HarnessName, SettingKey>;

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
	| "budgetUsd"
	| "maxTurns"
	| "resumeInterruptedRuns"
	| "cleanUpRuns"
	| "cleanUpAfterDays"
> & {
	policy: Omit<
		ResolvedPolicy,
		"maxSteps" | "resumeInterruptedRuns" | "budgetUsd" | "maxTurns"
	>;
};

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
	"Night Shift was started with schedules turned off. You cannot turn them on here. To turn them on, start Night Shift again with schedules on.";

export function createSettingsStore(options: {
	document: DeviceDocument;
	env: Readonly<Record<string, string | undefined>>;
}): SettingsStore {
	const { document, env } = options;
	const saved = mapView(document, document.settings, () => {
		const out = new Map<SettingKey, unknown>();
		for (const [key, value] of document.settings.entries()) {
			if (!Object.hasOwn(DEFS, key)) continue;
			const parsed = DEFS[key as SettingKey].schema.safeParse(value);
			// A value saved by an older build that no longer parses is ignored.
			if (parsed.success) out.set(key as SettingKey, parsed.data);
		}
		return out;
	});

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
		if (saved().has(key))
			return { value: saved().get(key), source: "saved", ...base };
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
		// The document is read when it opens; a remote edit applies at once.
		async load() {},
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
				throw new Refusal(
					"invalid",
					"The first usage-limit wait cannot be longer than the longest one.",
				);
			}
			await document.change(() => {
				for (const key of SETTING_KEYS) {
					const value = parsed[key];
					if (value === null) document.settings.delete(key);
					else if (value !== undefined) document.settings.set(key, value);
				}
			});
			return view();
		},
		run() {
			const s = current();
			return {
				scheduler: s.scheduler,
				maxConcurrentRuns: s.maxConcurrentRuns,
				maxStepsPerRun: s.maxStepsPerRun,
				budgetUsd: s.budgetUsd,
				maxTurns: s.maxTurns,
				resumeInterruptedRuns: s.resumeInterruptedRuns,
				cleanUpRuns: s.cleanUpRuns,
				cleanUpAfterDays: s.cleanUpAfterDays,
				policy: {
					usageLimitFirstWaitMinutes: s.usageLimitFirstWaitMinutes,
					usageLimitMaxWaitMinutes: s.usageLimitMaxWaitMinutes,
					networkGraceMinutes: s.networkGraceMinutes,
					idleMinutes: s.idleMinutes,
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
		budgetUsd: DEFS.budgetUsd.default,
		maxTurns: DEFS.maxTurns.default,
		resumeInterruptedRuns: DEFS.resumeInterruptedRuns.default,
		cleanUpRuns: DEFS.cleanUpRuns.default,
		cleanUpAfterDays: DEFS.cleanUpAfterDays.default,
		policy: {
			usageLimitFirstWaitMinutes: DEFS.usageLimitFirstWaitMinutes.default,
			usageLimitMaxWaitMinutes: DEFS.usageLimitMaxWaitMinutes.default,
			networkGraceMinutes: DEFS.networkGraceMinutes.default,
			idleMinutes: DEFS.idleMinutes.default,
		},
	};
}
