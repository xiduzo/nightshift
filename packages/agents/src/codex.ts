/**
 * The Codex harness: one `codex exec --experimental-json` per session, driven
 * through `@tanstack/ai-codex` and the local-process sandbox in `input.cwd`.
 *
 * Codex runs non-interactively: it never asks for approval (`approval_policy
 * = "never"` in every mode), it refuses what its own sandbox forbids. The
 * permission mode picks that sandbox (see `codexPolicy`).
 *
 * The adapter bridges `chat()` tools over MCP (`mcp_servers.tanstack`), so
 * `report_step` and the GitHub tools work as in Claude Code, and the node's
 * own MCP servers go in as `--config mcp_servers.<name>.*` overrides: they
 * live only on the command line, no config file is written.
 *
 * Unverified: the `codex` CLI was not installed when this was written. It is
 * tested against a fake `codex` that speaks the JSONL the adapter expects.
 */
import { randomUUID } from "node:crypto";
import { chat } from "@tanstack/ai";
import { CODEX_MODELS, codexText } from "@tanstack/ai-codex";
import {
	defineSandbox,
	defineWorkspace,
	localSource,
	withSandbox,
} from "@tanstack/ai-sandbox";
import { localProcessSandbox } from "@tanstack/ai-sandbox-local-process";
import {
	providerTap,
	removeProjectionMarkers,
	runAdapterSession,
	shellQuote,
} from "./adapter-session";
import { type GithubToolsOptions, githubTools } from "./github";
import { reportStepTool, stepReportSetup } from "./step-report";
import {
	createTranslator,
	failureKind,
	type HarnessProfile,
	type SdkSignals,
	type Translator,
} from "./translate";
import type {
	AgentEvent,
	AgentHarness,
	AgentSessionInput,
	Effort,
	McpServerConfig,
	PermissionMode,
} from "./types";

export type CodexHarnessOptions = {
	/** Path or name of the `codex` executable. Defaults to `codex`. */
	codexExecutable?: string;
	/** Extra environment variables for the `codex` process. */
	env?: Record<string, string>;
	/** Extra writable directories (`--add-dir`), for example a worktree's git dir. */
	additionalDirectories?: string[];
	/** Extra raw `--config key=value` overrides (TOML values). The harness's own win. */
	config?: Record<string, string>;
	/** How long to wait for the process to stop after an abort. Default 5 s. */
	abortGraceMs?: number;
	/** How the GitHub tools run `gh` and `git` (tests use fakes). */
	github?: Omit<GithubToolsOptions, "cwd">;
};

/** The adapter's CUSTOM event with the thread (session) id. */
export const CODEX_SESSION_EVENT = "codex.session-id";

export type CodexPolicy = {
	sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
	approvalPolicy: "never";
	networkAccessEnabled?: boolean;
};

/**
 * Codex's sandbox for a permission mode. Approval is always `never`: a
 * Codex session never waits for a person, it refuses instead.
 *
 * - `bypassPermissions`: `danger-full-access`, no sandbox.
 * - `auto`: `workspace-write` with network access: edits and commands in
 *   the worktree, and commands may reach the network (tests, `gh`, installs).
 * - `acceptEdits`: `workspace-write` without network access.
 * - `default` and `plan`: `read-only`.
 */
export function codexPolicy(mode: PermissionMode): CodexPolicy {
	switch (mode) {
		case "bypassPermissions":
			return { sandboxMode: "danger-full-access", approvalPolicy: "never" };
		case "auto":
			return {
				sandboxMode: "workspace-write",
				approvalPolicy: "never",
				networkAccessEnabled: true,
			};
		case "acceptEdits":
			return {
				sandboxMode: "workspace-write",
				approvalPolicy: "never",
				networkAccessEnabled: false,
			};
		default:
			return { sandboxMode: "read-only", approvalPolicy: "never" };
	}
}

/** A TOML key: bare when it can be, else quoted. */
function tomlKey(key: string): string {
	return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

/** A TOML basic string. JSON's escapes are valid TOML escapes. */
const tomlString = (value: string) => JSON.stringify(value);

function tomlTable(entries: Record<string, string>): string {
	const pairs = Object.entries(entries).map(
		([key, value]) => `${tomlKey(key)} = ${tomlString(value)}`,
	);
	return pairs.length > 0 ? `{ ${pairs.join(", ")} }` : "{}";
}

/** `--config` overrides (TOML values) that add the session's MCP servers. */
export function codexMcpConfig(
	servers: Record<string, McpServerConfig>,
): Record<string, string> {
	const config: Record<string, string> = {};
	for (const [name, server] of Object.entries(servers)) {
		const prefix = `mcp_servers.${tomlKey(name)}`;
		if ("url" in server) {
			config[`${prefix}.url`] = tomlString(server.url);
			if (Object.keys(server.headers).length > 0) {
				config[`${prefix}.http_headers`] = tomlTable(server.headers);
			}
		} else {
			config[`${prefix}.command`] = tomlString(server.command);
			config[`${prefix}.args`] =
				`[${server.args.map((arg) => tomlString(arg)).join(", ")}]`;
			if (Object.keys(server.env).length > 0) {
				config[`${prefix}.env`] = tomlTable(server.env);
			}
		}
	}
	return config;
}

/** Codex's `model_reasoning_effort` for an effort. Codex has no `max`. */
export function codexEffort(effort: Effort): string {
	return effort === "max" ? "xhigh" : effort;
}

const KNOWN_MODELS: ReadonlySet<string> = new Set(CODEX_MODELS);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the raw Codex JSONL events: the last agent message (for a text
 * report), the usage of `turn.completed`, the failure of `turn.failed` or a
 * fatal `error`, and a network hint from non-fatal error items (Codex
 * reports its reconnects there).
 */
export function observeCodexEvent(
	signals: SdkSignals,
	raw: unknown,
): SdkSignals {
	if (!isRecord(raw) || typeof raw.type !== "string") return signals;
	switch (raw.type) {
		case "item.started":
		case "item.updated":
		case "item.completed": {
			const item = isRecord(raw.item) ? raw.item : {};
			const text = typeof item.text === "string" ? item.text : undefined;
			if (item.type === "agent_message" && text !== undefined) {
				return { ...signals, resultText: text };
			}
			const message =
				typeof item.message === "string" ? item.message : undefined;
			if (item.type === "error" && message && failureKind(message)) {
				return failureKind(message) === "network"
					? { ...signals, networkError: message }
					: signals;
			}
			return signals;
		}
		case "turn.completed": {
			const usage = isRecord(raw.usage) ? raw.usage : undefined;
			if (!usage) return signals;
			const count = (value: unknown) =>
				typeof value === "number" && Number.isFinite(value) ? value : 0;
			return {
				...signals,
				resultUsage: {
					inputTokens: count(usage.input_tokens),
					outputTokens: count(usage.output_tokens),
				},
			};
		}
		case "turn.failed": {
			const error = isRecord(raw.error) ? raw.error : {};
			const message =
				typeof error.message === "string" && error.message
					? error.message
					: "Codex turn failed";
			return { ...signals, resultError: message };
		}
		case "error":
			return typeof raw.message === "string" && raw.message
				? { ...signals, resultError: signals.resultError ?? raw.message }
				: signals;
		default:
			return signals;
	}
}

export const CODEX_PROFILE: HarnessProfile = {
	label: "Codex",
	sessionEvent: CODEX_SESSION_EVENT,
	createObserver: () => observeCodexEvent,
};

/** The prompt, bridged tools and `--config` overrides of one Codex session. */
export function codexSetup(
	input: AgentSessionInput,
	options: CodexHarnessOptions = {},
) {
	// Codex runs MCP tools without approval in every sandbox mode, so plan
	// mode reports with the tool too.
	const report = stepReportSetup(
		{ ...input, permissionMode: "default" },
		undefined,
	);
	const github = input.tools?.includes("github")
		? githubTools({
				...options.github,
				cwd: input.cwd,
				...(input.effects ? { effects: input.effects } : {}),
			})
		: [];
	const ownEffort: Record<string, string> =
		input.effort !== undefined && !KNOWN_MODELS.has(input.model)
			? { model_reasoning_effort: tomlString(codexEffort(input.effort)) }
			: {};
	return {
		prompt: report.prompt,
		tools: [
			...(report.withTool ? [reportStepTool(input.stepReport)] : []),
			...github,
		],
		policy: codexPolicy(input.permissionMode),
		config: {
			...options.config,
			...ownEffort,
			...codexMcpConfig(input.mcpServers ?? {}),
		},
	};
}

function startChat(
	input: AgentSessionInput,
	options: CodexHarnessOptions,
	translator: Translator,
	abortController: AbortController,
): AsyncIterable<unknown> {
	const setup = codexSetup(input, options);
	const id = `nightshift-${randomUUID()}`;
	const sandbox = defineSandbox({
		id,
		provider: localProcessSandbox({ dir: input.cwd, removeOnDestroy: false }),
		fileEvents: false,
		// The middleware needs a workspace; see `opencode.ts`.
		workspace: defineWorkspace({ source: localSource(input.cwd), root: "." }),
		lifecycle: { reuse: "none", destroyOnComplete: true },
	});

	const adapter = codexText(input.model, {
		// The adapter runs `<executable> exec …` through `sh -c`.
		codexExecutable: shellQuote(options.codexExecutable ?? "codex"),
		sandboxMode: setup.policy.sandboxMode,
		approvalPolicy: setup.policy.approvalPolicy,
		...(setup.policy.networkAccessEnabled !== undefined
			? { networkAccessEnabled: setup.policy.networkAccessEnabled }
			: {}),
		...(options.additionalDirectories
			? { additionalDirectories: options.additionalDirectories }
			: {}),
		...(options.env ? { env: options.env } : {}),
		...(Object.keys(setup.config).length > 0 ? { config: setup.config } : {}),
	});

	return chat({
		adapter,
		threadId: id,
		messages: [{ role: "user", content: setup.prompt }],
		...(setup.tools.length > 0 ? { tools: setup.tools } : {}),
		...(input.resumeSessionId
			? { modelOptions: { sessionId: input.resumeSessionId } }
			: {}),
		// Known models: the adapter maps the level. Others: `codexSetup` sets
		// `model_reasoning_effort` itself.
		...(input.effort && KNOWN_MODELS.has(input.model)
			? { reasoning: { level: input.effort } as never }
			: {}),
		middleware: [withSandbox(sandbox)],
		abortController,
		debug: providerTap(translator),
	}) as AsyncIterable<unknown>;
}

/** Run one Codex session and translate it into AgentEvent values. Never throws. */
export function runCodexSession(
	input: AgentSessionInput,
	options: CodexHarnessOptions = {},
): AsyncGenerator<AgentEvent> {
	const translator = createTranslator({
		fallbackSessionId: input.resumeSessionId ?? randomUUID(),
		stepReport: input.stepReport ?? false,
		profile: CODEX_PROFILE,
		// A resumed thread may not announce itself again.
		...(input.resumeSessionId ? { knownSessionId: input.resumeSessionId } : {}),
	});
	return runAdapterSession({
		signal: input.signal,
		translator,
		start: (abortController) =>
			startChat(input, options, translator, abortController),
		...(options.abortGraceMs !== undefined
			? { abortGraceMs: options.abortGraceMs }
			: {}),
		cleanup: () => removeProjectionMarkers(input.cwd),
	});
}

/**
 * Runs Codex sessions through TanStack AI, on the host, in `input.cwd`, with
 * the user's `codex login` (or `CODEX_API_KEY` / `OPENAI_API_KEY` in the
 * environment). `model` is a Codex model id, for example `gpt-5.3-codex`.
 */
export function codexHarness(options: CodexHarnessOptions = {}): AgentHarness {
	return {
		name: "codex",
		run: (input) => runCodexSession(input, options),
	};
}
