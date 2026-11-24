import {
	type BuiltinAnswers,
	builtinAnswersSchema,
	type CustomAgent,
	customAgentSchema,
	DEFAULT_POLICY,
	type DeciderName,
	deciderNameSchema,
	HARNESS_CATALOG,
	type HarnessName,
	harnessNameSchema,
	permissionModeSchema,
} from "@nightshift/flows";
import { z } from "zod";
import { int, list, ollamaHostAddress, onOff, text } from "./env-values";
import { hostAddressSchema, isHttpAddress } from "./host-address";

/**
 * The daemon's settings. Each one is changed in the UI and saved in this
 * Device's document; a setting with no saved value falls back to the
 * daemon's environment, then to its default. Two exceptions lock a switch
 * off over a saved value: `NIGHTSHIFT_SCHEDULER=off`, so a dev daemon on a
 * copy of the database never starts the night's schedules, and anonymous
 * usage when `DO_NOT_TRACK=1`, `NIGHTSHIFT_USAGE=off` or
 * `OTEL_SDK_DISABLED=true`.
 */

export type Def<T> = {
	schema: z.ZodType<T>;
	default: T;
	/** The environment variable that is the fallback. */
	env?: string;
	/** Reads the variable. Undefined when it does not make a valid value. */
	fromEnv?: (raw: string) => T | undefined;
};

const positiveMinutes = z.number().positive().max(10_080);

/** The protocols of the OTLP export: HTTP with protobuf or with JSON. */
export const telemetryProtocolSchema = z.enum(["http/protobuf", "http/json"]);
export type TelemetryProtocol = z.infer<typeof telemetryProtocolSchema>;

/** A header name, as HTTP allows it. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * The headers of the OTLP export, name → value. A value that must stay
 * secret (an API key) is a `${NAME}` reference to a secret, as in an MCP
 * connection: `Bearer ${GRAFANA_TOKEN}`. Plain values are fine for the rest.
 */
const telemetryHeadersSchema = z
	.record(
		z.string().regex(HEADER_NAME, "Use a header name such as Authorization."),
		z.string().trim().min(1, "A header needs a value.").max(4000),
	)
	.refine((headers) => Object.keys(headers).length <= 32, {
		message: "Use at most 32 headers.",
	});

/** Whether Night Shift searches by meaning, and when it starts Ollama for it. */
const ollamaModeSchema = z.enum(["auto", "on", "off"]);
type OllamaMode = z.infer<typeof ollamaModeSchema>;

export const DEFS = {
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
	 * The cleanup of what runs leave on this computer (`cleanup/`, ADR 28).
	 * A day after a run ended, its worktree and local branches go, and the
	 * work that is only here goes to kept refs first. The kept refs go once
	 * the run is `cleanUpAfterDays` old. A run folder (a run of a project
	 * without a folder, ADR 22) goes with its files then, whatever is in
	 * it. The folder of a run this computer does not know goes
	 * `cleanUpAfterDays` after its last change. An open run keeps all of it.
	 */
	cleanUpRuns: {
		schema: z.boolean(),
		default: true,
		env: "NIGHTSHIFT_CLEAN_UP_RUNS",
		fromEnv: onOff,
	} satisfies Def<boolean>,
	// 90 days keeps every run that the overviews and their graphs look back on.
	// It counts for kept work and run folders. Worktrees and branches go after a day.
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
	/**
	 * Who answers for each of Night Shift's own agents (the Builder, the
	 * Explainer, the Decider, ...). An agent with no entry follows this
	 * computer: `assistantProfile` or the first profile that works for an
	 * agent, the decider's default for a model.
	 */
	builtinAgents: {
		schema: builtinAnswersSchema,
		default: {},
	} satisfies Def<BuiltinAnswers>,
	/**
	 * New Decision nodes start on this decider. Unsaved, the readers see
	 * the effective default instead (`withEffectiveDecider`).
	 */
	decisionDecider: {
		schema: deciderNameSchema,
		default: "typesafe",
	} satisfies Def<DeciderName>,
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
	 * "Web requests reach this network": a Host's Web request steps and
	 * Waits for a URL may reach this computer (loopback) and its private
	 * network (RFC 1918, unique local, carrier-grade NAT). Off by default:
	 * a Host serves every Member of its Spaces. A computer that is not a
	 * Host always may (`reachesPrivateNetwork`).
	 */
	webRequestsPrivateNetwork: {
		schema: z.boolean(),
		default: false,
		env: "NIGHTSHIFT_WEB_REQUESTS_PRIVATE_NETWORK",
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
	/**
	 * "Send runs to your monitoring": the runs this computer walks go out
	 * as OpenTelemetry traces and metrics to `telemetryEndpoint`, and its
	 * Claude Code sessions send their own there too. Off by default:
	 * nothing leaves the computer until a person turns it on.
	 */
	telemetry: {
		schema: z.boolean(),
		default: false,
		env: "NIGHTSHIFT_TELEMETRY",
		fromEnv: onOff,
	} satisfies Def<boolean>,
	/**
	 * Anonymous usage leaves this computer. On by default. Nothing is sent
	 * until the person has seen the notice (`usageSeen`), unless the
	 * environment sets this itself.
	 */
	usage: {
		schema: z.boolean(),
		default: true,
		env: "NIGHTSHIFT_USAGE",
		fromEnv: onOff,
	} satisfies Def<boolean>,
	/** The person has seen the usage notice, or saved this switch. */
	usageSeen: {
		schema: z.boolean(),
		default: false,
	} satisfies Def<boolean>,
	/** The OTLP endpoint, without `/v1/traces`: `http://localhost:4318`. Empty: none. */
	telemetryEndpoint: {
		schema: z
			.string()
			.trim()
			.max(2000)
			.refine((value) => value === "" || isHttpAddress(value), {
				message:
					"Use an http:// or https:// address, for example http://localhost:4318.",
			}),
		default: "",
		env: "NIGHTSHIFT_OTLP_ENDPOINT",
		fromEnv: text,
	} satisfies Def<string>,
	/** How the export talks OTLP over HTTP: protobuf (most receivers), or JSON. */
	telemetryProtocol: {
		schema: telemetryProtocolSchema,
		default: "http/protobuf",
	} satisfies Def<TelemetryProtocol>,
	/**
	 * Sent with every request of the export. A secret value stays a
	 * `${NAME}` reference here: its value is in the secrets, never in this
	 * document.
	 */
	telemetryHeaders: {
		schema: telemetryHeadersSchema,
		default: {},
	} satisfies Def<Record<string, string>>,
	/**
	 * Search by meaning, and the Ollama Night Shift starts for it. `auto`:
	 * a Host starts Ollama itself, another computer uses the Ollama that
	 * answers. `on`: this computer starts it too. `off`: search finds by
	 * words only, and Night Shift starts nothing (`ollama/`).
	 */
	ollama: {
		schema: ollamaModeSchema,
		default: "auto",
		env: "NIGHTSHIFT_OLLAMA",
		fromEnv: (raw: string) => {
			const value = raw.trim().toLowerCase();
			if (value === "auto") return "auto";
			const on = onOff(value);
			return on === undefined ? undefined : on ? "on" : "off";
		},
	} satisfies Def<OllamaMode>,
	/** The embedding model of search by meaning: a model name as Ollama knows it. */
	embeddingModel: {
		schema: z
			.string()
			.trim()
			.min(1, "Name a model, for example qwen3-embedding:0.6b.")
			.max(200)
			.regex(/^[\w.:/-]+$/, "Use a model name such as qwen3-embedding:0.6b."),
		// The wire gives the real default (`SettingsGround.embeddingModel`).
		default: "",
		env: "NIGHTSHIFT_EMBEDDING_MODEL",
		fromEnv: text,
	} satisfies Def<string>,
	/**
	 * Where Night Shift finds Ollama. Empty: the Ollama on this computer,
	 * the one Night Shift started or the one that answers there. The
	 * fallback is `OLLAMA_HOST`, as Ollama's own CLI reads it.
	 */
	ollamaAddress: {
		schema: z
			.string()
			.trim()
			.max(2000)
			.refine((value) => value === "" || isHttpAddress(value), {
				message:
					"Use an http:// or https:// address, for example http://studio.local:11434.",
			}),
		default: "",
		env: "OLLAMA_HOST",
		fromEnv: ollamaHostAddress,
	} satisfies Def<string>,
	/**
	 * Sent with every request to Ollama at `ollamaAddress`, for an Ollama
	 * behind a proxy. A secret value stays a `${NAME}` reference here, as
	 * in `telemetryHeaders`.
	 */
	ollamaHeaders: {
		schema: telemetryHeadersSchema,
		default: {},
	} satisfies Def<Record<string, string>>,
};

export type Defs = typeof DEFS;
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
