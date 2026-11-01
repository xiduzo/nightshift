/**
 * The OpenCode harness: one `opencode serve` per session, driven through
 * `@tanstack/ai-opencode` on the shared harness session
 * (`session/adapter-session.ts`).
 *
 * The adapter starts `opencode serve` with a fixed command (`opencode` on the
 * PATH, port 4096, all interfaces) and puts its own tool bridge in
 * `OPENCODE_CONFIG_CONTENT`. The harness wraps the sandbox so that command
 * runs the configured executable, and merges the session's config into that
 * variable: the permission rules of the permission mode, the node's MCP
 * servers, no auto-update, no sharing. `OPENCODE_CONFIG_CONTENT` is the
 * highest config tier, so it wins over the user's and the project's config,
 * and it lives only in the server's environment: no config file is written.
 *
 * Permissions. The adapter answers OpenCode's legacy `permission.updated`
 * events only, so a rule that resolves to `ask` could leave an unattended
 * session waiting. Every mode therefore sets each permission to `allow` or
 * `deny` (see `opencodePermission` in `permissions.ts`); nothing asks.
 *
 * Tools. The adapter bridges `chat()` tools over MCP, so `report_step` works
 * as in Claude Code (OpenCode names it `tanstack_report_step`; the adapter
 * maps it back). It is allowed in every mode, plan mode too, so the report
 * always uses the tool.
 *
 * Versions. `@tanstack/ai-opencode` 0.5 speaks the OpenCode 1.x server API
 * (`@opencode-ai/sdk` 1.x). OpenCode 2.x serves a different API (`/api/…`,
 * password auth) and prints another ready line: the adapter cannot drive it.
 * Point `opencodeExecutable` at a 1.x `opencode`. A 1.x server also refuses a
 * data directory that a 2.x server already migrated.
 *
 * Lifecycle quirks of the adapter, handled here:
 * - It opens a tool call on OpenCode's first, empty update, so the input
 *   comes from the raw events (`toolInputFromSignals`).
 * - OpenCode echoes the prompt as a text part; the raw events tell it apart.
 * - It holds RUN_FINISHED until its event subscription sees one more server
 *   event (a heartbeat, every ~10 s). The raw `done` settles the session at
 *   once and the adapter's teardown finishes in the background.
 * - An abort reaches the server as a session abort; the server process is
 *   killed only if it is still alive 10 s later (see `withSpawnRewrite`).
 */

import { parseInstant, now as timeNow } from "@nightshift/time";
import type { SandboxHandle, SandboxProvider } from "@tanstack/ai-sandbox";
import type {
	AgentHarness,
	AgentSessionInput,
	AgentUsage,
	McpServerConfig,
} from "../../port";
import { shellQuoteAlways } from "../../port";
import type { HarnessProfile, SdkSignals } from "../../session";
import {
	type AdapterSetup,
	freePort,
	type HarnessSpec,
	harnessSession,
	readOnlyInput,
} from "../../session";
import { harnessFacts } from "../facts";
import { adapterPermissionMode, opencodePermission } from "./permissions";

export type OpencodeHarnessOptions = {
	/** Path or name of the `opencode` executable. Defaults to `opencode`. */
	opencodeExecutable?: string;
	/** Extra environment variables for the `opencode serve` process. */
	env?: Record<string, string>;
	/**
	 * Extra OpenCode config for every session, under the harness's own
	 * settings (permissions and MCP servers win).
	 */
	config?: Record<string, unknown>;
	/** How long to wait for the server to stop after an abort. Default 5 s. */
	abortGraceMs?: number;
};

/** The adapter's CUSTOM event with the session id. */
export const OPENCODE_SESSION_EVENT = "opencode.session-id";

/** OpenCode's `mcp` config for the session's MCP servers. */
export function opencodeMcpConfig(
	servers: Record<string, McpServerConfig>,
): Record<string, unknown> {
	const mcp: Record<string, unknown> = {};
	for (const [name, server] of Object.entries(servers)) {
		mcp[name] =
			"url" in server
				? {
						type: "remote",
						url: server.url,
						headers: server.headers,
						enabled: true,
					}
				: {
						type: "local",
						command: [server.command, ...server.args],
						environment: server.env,
						enabled: true,
					};
	}
	return mcp;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Merge plain objects; `over` wins, arrays and other values replace. */
export function mergeConfig(
	base: Record<string, unknown>,
	over: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(over)) {
		const current = out[key];
		out[key] =
			isPlainObject(current) && isPlainObject(value)
				? mergeConfig(current, value)
				: value;
	}
	return out;
}

/** The session's own OpenCode config, before the adapter's bridge. */
export function opencodeSessionConfig(
	input: Pick<
		AgentSessionInput,
		"permissionMode" | "mcpServers" | "clis" | "addDirs"
	>,
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	const servers = input.mcpServers ?? {};
	const names = Object.keys(servers);
	return mergeConfig(extra, {
		autoupdate: false,
		share: "disabled",
		permission: opencodePermission(
			input.permissionMode,
			names,
			input.clis ?? [],
			input.addDirs ?? [],
		),
		...(names.length > 0 ? { mcp: opencodeMcpConfig(servers) } : {}),
	});
}

const SERVE_COMMAND = /^opencode serve(?=\s|$)/;

/**
 * Rewrite the adapter's `opencode serve` command: run `executable`, merge
 * `config` under the adapter's `OPENCODE_CONFIG_CONTENT` (its bridge wins),
 * and add `env`. Other commands pass through.
 */
export function rewriteServe(
	command: string,
	env: Record<string, string> | undefined,
	options: {
		executable: string;
		config: Record<string, unknown>;
		env?: Record<string, string>;
	},
): { command: string; env: Record<string, string> | undefined } {
	if (!SERVE_COMMAND.test(command)) return { command, env };
	let adapterConfig: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(env?.OPENCODE_CONFIG_CONTENT ?? "{}");
		if (isPlainObject(parsed)) adapterConfig = parsed;
	} catch {
		// Not JSON: the session config alone.
	}
	return {
		command: command.replace(
			SERVE_COMMAND,
			`${shellQuoteAlways(options.executable)} serve`,
		),
		env: {
			...options.env,
			...env,
			OPENCODE_CONFIG_CONTENT: JSON.stringify(
				mergeConfig(options.config, adapterConfig),
			),
		},
	};
}

/**
 * A sandbox provider whose handles run `spawn` commands through `rewrite`,
 * and stop a spawned process only `killAfterAbortMs` after an abort.
 */
export function withSpawnRewrite(
	provider: SandboxProvider,
	rewrite: (
		command: string,
		env: Record<string, string> | undefined,
	) => { command: string; env: Record<string, string> | undefined },
	killAfterAbortMs = 10_000,
): SandboxProvider {
	const wrap = (handle: SandboxHandle): SandboxHandle => {
		const process: SandboxHandle["process"] = {
			exec: (command, opts) => handle.process.exec(command, opts),
			spawn: async (command, opts) => {
				const next = rewrite(command, opts?.env);
				// Not killed on abort right away: an abort reaches the server as
				// a session abort, the turn ends, and the adapter's own teardown
				// stops the server. A server killed at once can leave the
				// adapter's event subscription retrying. A server that does not
				// stop within `killAfterAbortMs` is killed.
				const { signal, ...rest } = opts ?? {};
				const spawned = await handle.process.spawn(next.command, {
					...rest,
					...(next.env ? { env: next.env } : {}),
				});
				if (signal) {
					const kill = () => {
						const timer = setTimeout(
							() => void spawned.kill().catch(() => {}),
							killAfterAbortMs,
						);
						timer.unref?.();
						void spawned.wait().then(
							() => clearTimeout(timer),
							() => clearTimeout(timer),
						);
					};
					if (signal.aborted) kill();
					else signal.addEventListener("abort", kill, { once: true });
				}
				return spawned;
			},
		};
		return new Proxy(handle, {
			get(target, prop) {
				if (prop === "process") return process;
				const value = Reflect.get(target, prop, target);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
	};
	return {
		name: provider.name,
		capabilities: () => provider.capabilities(),
		create: async (input) => wrap(await provider.create(input)),
		resume: async (input) => {
			const handle = await provider.resume(input);
			return handle ? wrap(handle) : null;
		},
		destroy: (input) => provider.destroy(input),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** `retry-after` in seconds or as an HTTP date, as epoch ms. */
function retryAfter(headers: unknown, now: number): number | undefined {
	if (!isRecord(headers)) return undefined;
	const entry = Object.entries(headers).find(
		([key]) => key.toLowerCase() === "retry-after",
	);
	const value = typeof entry?.[1] === "string" ? entry[1] : undefined;
	if (!value) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds)) return now + seconds * 1000;
	const date = parseInstant(value);
	return Number.isNaN(date) ? undefined : date;
}

/**
 * Fold an OpenCode message error (`{ name, data: { message, statusCode } }`)
 * into the signals: an HTTP 429 is a usage limit, a 5xx the network; the
 * text decides the rest (see `failureKind`).
 */
export function opencodeErrorSignals(
	signals: SdkSignals,
	error: unknown,
	now = timeNow(),
): SdkSignals {
	if (!isRecord(error)) return signals;
	const data = isRecord(error.data) ? error.data : {};
	const name = typeof error.name === "string" ? error.name : "UnknownError";
	const message =
		typeof data.message === "string" && data.message ? data.message : name;
	const status = typeof data.statusCode === "number" ? data.statusCode : 0;
	const next: SdkSignals = { ...signals, resultError: message };
	if (status === 429) {
		const resetAt = retryAfter(data.responseHeaders, now);
		return {
			...next,
			usageLimit: { message, ...(resetAt !== undefined ? { resetAt } : {}) },
		};
	}
	if (status >= 500) return { ...next, networkError: message };
	return next;
}

type Step = { usage: AgentUsage; cost?: number };

function stepOf(info: Record<string, unknown>): Step {
	const tokens = isRecord(info.tokens) ? info.tokens : {};
	const cache = isRecord(tokens.cache) ? tokens.cache : {};
	return {
		usage: {
			inputTokens: num(tokens.input) + num(cache.read) + num(cache.write),
			outputTokens: num(tokens.output) + num(tokens.reasoning),
		},
		...(typeof info.cost === "number" ? { cost: info.cost } : {}),
	};
}

/**
 * Read the raw OpenCode stream (`{ kind: 'event' | 'session' | 'done' }`):
 * the last assistant text part (for a text report), the usage and cost
 * summed over every assistant message of the turn (OpenCode makes one per
 * step), the errors of the messages and the session, the tool inputs (the
 * adapter opens a call on its first update, before it has its input), the
 * echoed user text (hidden), and the end of the turn (`done`).
 */
export function createOpencodeObserver(): (
	signals: SdkSignals,
	raw: unknown,
) => SdkSignals {
	const texts = new Map<string, string>();
	const steps = new Map<string, Step>();
	/** Message ids of the user's messages, and their text part ids. */
	const userMessages = new Set<string>();
	const hiddenTextIds = new Set<string>();
	const toolInputs: Record<string, unknown> = {};

	const withUsage = (signals: SdkSignals): SdkSignals => {
		if (steps.size === 0) return signals;
		let inputTokens = 0;
		let outputTokens = 0;
		let cost: number | undefined;
		for (const step of steps.values()) {
			inputTokens += step.usage.inputTokens;
			outputTokens += step.usage.outputTokens;
			if (step.cost !== undefined) cost = (cost ?? 0) + step.cost;
		}
		const usage: AgentUsage = {
			inputTokens,
			outputTokens,
			...(cost !== undefined ? { costUsd: cost } : {}),
		};
		// The total of the steps so far is also the usage so far.
		return { ...signals, resultUsage: usage, liveUsage: usage };
	};

	const message = (signals: SdkSignals, info: unknown): SdkSignals => {
		if (!isRecord(info)) return signals;
		if (info.role === "user" && typeof info.id === "string") {
			userMessages.add(info.id);
			return signals;
		}
		if (info.role !== "assistant") return signals;
		if (typeof info.id === "string") steps.set(info.id, stepOf(info));
		const next = withUsage(signals);
		return info.error === undefined
			? next
			: opencodeErrorSignals(next, info.error);
	};

	/** A tool part's input, once it has one (the first update is empty). */
	const tool = (
		signals: SdkSignals,
		part: Record<string, unknown>,
	): SdkSignals => {
		const state = isRecord(part.state) ? part.state : {};
		const input = state.input;
		if (typeof part.callID !== "string" || !isRecord(input)) return signals;
		if (Object.keys(input).length === 0) return signals;
		toolInputs[part.callID] = input;
		return { ...signals, toolInputs };
	};

	const text = (signals: SdkSignals, id: unknown, value: string) => {
		if (typeof id !== "string") return signals;
		texts.set(id, value);
		return { ...signals, resultText: value };
	};

	return (signals, raw) => {
		if (!isRecord(raw)) return signals;
		if (raw.kind === "done") {
			return { ...message(signals, raw.message), done: true };
		}
		if (raw.kind !== "event" || !isRecord(raw.event)) return signals;
		const { type, properties } = raw.event;
		if (!isRecord(properties)) return signals;
		switch (type) {
			case "message.part.updated": {
				const part = properties.part;
				if (!isRecord(part)) return signals;
				if (part.type === "tool") return tool(signals, part);
				if (part.type !== "text") return signals;
				if (
					typeof part.messageID === "string" &&
					userMessages.has(part.messageID) &&
					typeof part.id === "string"
				) {
					hiddenTextIds.add(part.id);
					return { ...signals, hiddenTextIds };
				}
				const delta =
					typeof properties.delta === "string" ? properties.delta : undefined;
				const full =
					typeof part.text === "string"
						? part.text
						: `${texts.get(String(part.id)) ?? ""}${delta ?? ""}`;
				return text(signals, part.id, full);
			}
			case "message.part.delta": {
				if (properties.field !== "text") return signals;
				if (typeof properties.delta !== "string") return signals;
				const id = properties.partID;
				return text(
					signals,
					id,
					`${texts.get(String(id)) ?? ""}${properties.delta}`,
				);
			}
			case "message.updated":
				return message(signals, properties.info);
			case "session.error":
				return opencodeErrorSignals(signals, properties.error);
			default:
				return signals;
		}
	};
}

export const OPENCODE_PROFILE: HarnessProfile = {
	label: "OpenCode",
	sessionEvent: OPENCODE_SESSION_EVENT,
	createObserver: createOpencodeObserver,
	usageFromSignals: true,
	toolInputFromSignals: true,
};

/**
 * OpenCode's session knobs. The bridged tools are allowed in every mode
 * (see `opencodePermission` in `permissions.ts`), so plan mode reports
 * with the tool too. The adapter maps `reasoning` for the models it knows; any level type-checks
 * against an unknown model as `never`.
 */
export const OPENCODE_SPEC: HarnessSpec = {
	profile: OPENCODE_PROFILE,
	report: "tool",
	reasoningFor: () => true,
};

/**
 * The `opencode` adapter of one session: a server on a free loopback port,
 * whose spawn is rewritten to the configured executable and config.
 */
async function opencodeAdapter(
	input: AgentSessionInput,
	options: OpencodeHarnessOptions,
): Promise<AdapterSetup> {
	// The adapter package loads on the first session, not when Night Shift starts.
	const { opencodeText } = await import("@tanstack/ai-opencode");
	const port = await freePort();
	const executable = options.opencodeExecutable ?? "opencode";
	const config = opencodeSessionConfig(input, options.config);
	const adapter = opencodeText(input.model, {
		// One port per session, on the loopback interface only.
		port,
		hostname: "127.0.0.1",
		permissionMode: adapterPermissionMode(input.permissionMode),
	});
	return {
		adapter,
		wrapProvider: (provider) =>
			withSpawnRewrite(provider, (command, env) =>
				rewriteServe(command, env, {
					executable,
					config,
					...(options.env ? { env: options.env } : {}),
				}),
			),
	};
}

/**
 * Runs OpenCode sessions through TanStack AI, on the host, in `input.cwd`.
 * `model` is OpenCode's `provider/model`, for example
 * `anthropic/claude-sonnet-4-5` or `ollama/qwen3:8b`.
 */
export function opencodeHarness(
	options: OpencodeHarnessOptions = {},
): AgentHarness {
	return {
		name: "opencode",
		...harnessFacts("opencode"),
		run: (raw) => {
			const input = readOnlyInput(raw);
			return harnessSession({
				input,
				spec: OPENCODE_SPEC,
				adapter: () => opencodeAdapter(input, options),
				...(options.abortGraceMs !== undefined
					? { abortGraceMs: options.abortGraceMs }
					: {}),
			});
		},
	};
}
