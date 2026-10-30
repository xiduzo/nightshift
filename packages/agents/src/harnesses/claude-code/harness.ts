/**
 * The Claude Code harness: one `claude` process per session, driven through
 * `@tanstack/ai-claude-code` on the shared harness session
 * (`session/adapter-session.ts`). This file holds what is Claude Code's own: the
 * effort env for models the adapter does not know, the `--allowedTools`
 * rules for CLI tools and MCP servers, the `--mcp-config` temp file, and the
 * flag and env that bring out its thinking and its subagents' text.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaudeCodeSettingSource } from "@tanstack/ai-claude-code";
import type {
	AgentHarness,
	AgentSessionInput,
	Effort,
	McpServerConfig,
} from "../../port";
import {
	type AdapterSetup,
	type HarnessSpec,
	harnessSession,
	readOnlyInput,
	type SessionReport,
} from "../../session";
import { harnessFacts } from "../facts";
import { CLAUDE_CODE_PROFILE } from "./profile";
import { claudeKnowsThinkingDisplay } from "./version";

/** How a `claude` process is started. Shared by the harness and the decider. */
export type ClaudeCodeProcessOptions = {
	/** Path or name of the `claude` executable. Defaults to `claude`. */
	claudeExecutable?: string;
	/** Extra environment variables for the `claude` process. */
	env?: Record<string, string>;
	/** How long to wait for the process to stop after an abort. Default 5 s. */
	abortGraceMs?: number;
};

export type ClaudeCodeHarnessOptions = ClaudeCodeProcessOptions & {
	/**
	 * Built-in tools the session may use without a prompt (`--allowedTools`).
	 * With `stepReport`, the report tool is added (see `session/step-report.ts`); the
	 * session's CLI tools and MCP servers are added too (see `claudeAllowedTools`).
	 */
	allowedTools?: string[];
	/** Built-in tools removed from the session (`--disallowedTools`). */
	disallowedTools?: string[];
	/** Settings tiers to load. Defaults to all three, like the `claude` CLI. */
	settingSources?: ClaudeCodeSettingSource[];
};

/**
 * The adapter maps `chat({ reasoning })` only for the models it knows. For
 * any other model (a newer id), set the effort through Claude Code's own env.
 */
export function effortEnv(
	model: string,
	effort: Effort | undefined,
	knowsReasoning: (model: string) => boolean,
): Record<string, string> {
	if (effort === undefined || knowsReasoning(model)) return {};
	return { CLAUDE_CODE_EFFORT_LEVEL: effort };
}

const KNOWN_REASONING_MODELS = new Set([
	"claude-opus-4-8",
	"claude-opus-4-7",
	"claude-opus-4-6",
	"claude-sonnet-4-6",
	"claude-haiku-4-5",
	"opus",
	"sonnet",
	"haiku",
]);

/**
 * The `claude` command for `claudeExecutable`. The adapter splits that value
 * on spaces into argv (no shell) and puts it before its own flags.
 *
 * `mcpConfigPath` adds the session's own MCP servers with `--mcp-config`.
 * The adapter passes its bridge with a second `--mcp-config`; the flag is
 * variadic, and Claude Code loads the servers of both.
 *
 * `showThinking` asks for the thinking as summaries: `claude -p` sends it
 * empty without the flag. Only Claude Code 2.1.94 and later know it (see
 * `version.ts`).
 */
export function claudeCommand(
	executable: string | undefined,
	mcpConfigPath?: string,
	strictMcp = false,
	maxBudgetUsd?: number,
	showThinking = false,
): string {
	return [
		executable ?? "claude",
		...(showThinking ? ["--thinking-display", "summarized"] : []),
		...(mcpConfigPath !== undefined ? ["--mcp-config", mcpConfigPath] : []),
		// Only the servers of `--mcp-config` load: the session's and the bridge.
		...(strictMcp ? ["--strict-mcp-config"] : []),
		// The adapter has no option for it. Claude Code stops the session
		// past it with `error_max_budget_usd`.
		...(maxBudgetUsd !== undefined
			? ["--max-budget-usd", budgetArg(maxBudgetUsd)]
			: []),
	].join(" ");
}

/** A budget in dollars as `--max-budget-usd` takes it: cents, rounded down, never 0. */
function budgetArg(usd: number): string {
	return Math.max(0.01, Math.floor(usd * 100) / 100).toFixed(2);
}

/**
 * The tools a read-only session never gets (`--disallowedTools`): every
 * built-in tool that writes a file or runs a command, and subagents, which
 * could. A deny rule wins over the person's own allow rules, which
 * `--permission-mode default` alone would still apply. Read, Glob, Grep and
 * the bridged tools stay.
 */
export const READ_ONLY_DISALLOWED = [
	"Bash",
	"Edit",
	"MultiEdit",
	"NotebookEdit",
	"Write",
	"Task",
	"Agent",
] as const;

/** `--disallowedTools` of one session: the harness's own, and the read-only list. */
export function claudeDisallowedTools(
	input: Pick<AgentSessionInput, "readOnly">,
	own: string[] | undefined,
): string[] | undefined {
	if (!input.readOnly) return own;
	return [...new Set([...(own ?? []), ...READ_ONLY_DISALLOWED])];
}

/** Claude Code's `--mcp-config` JSON for the session's MCP servers. */
export function claudeMcpConfig(
	servers: Record<string, McpServerConfig>,
): string {
	const mcpServers: Record<string, unknown> = {};
	for (const [name, server] of Object.entries(servers)) {
		mcpServers[name] =
			"url" in server
				? { type: "http", url: server.url, headers: server.headers }
				: {
						type: "stdio",
						command: server.command,
						args: server.args,
						env: server.env,
					};
	}
	return JSON.stringify({ mcpServers });
}

/**
 * Write the session's MCP servers to a private temp file, outside the
 * worktree (it may hold secrets). Returns its path and a cleanup.
 */
async function writeMcpConfig(
	servers: Record<string, McpServerConfig> | undefined,
): Promise<{ path?: string; cleanup: () => Promise<void> }> {
	if (!servers || Object.keys(servers).length === 0) {
		return { cleanup: async () => {} };
	}
	const dir = await mkdtemp(join(tmpdir(), "nightshift-mcp-"));
	const path = join(dir, "mcp.json");
	const cleanup = () => rm(dir, { recursive: true, force: true });
	if (/\s/.test(path)) {
		await cleanup();
		// The adapter splits the executable string on spaces.
		throw new Error(`The temp directory has a space in its path: ${path}`);
	}
	await writeFile(path, claudeMcpConfig(servers), { mode: 0o600 });
	return { path, cleanup };
}

/**
 * Claude Code permission rules that let the agent run each CLI tool in its
 * shell without a prompt: `Bash(gh:*)` allows `gh` with any arguments. Plan
 * mode runs nothing, so it gets none.
 */
export function cliAllowRules(
	input: Pick<AgentSessionInput, "clis" | "permissionMode">,
): string[] {
	if (input.permissionMode === "plan") return [];
	return (input.clis ?? []).map((name) => `Bash(${name}:*)`);
}

/**
 * `--allowedTools` of one session: the report's rules (the harness's own
 * list plus the report tool), then the CLI tools and the MCP servers. The
 * node lists those on purpose: they run without a prompt (`mcp__<server>`
 * allows every tool of the server).
 */
export function claudeAllowedTools(
	input: Pick<AgentSessionInput, "clis" | "permissionMode" | "mcpServers">,
	reportAllowed: string[] | undefined,
): string[] | undefined {
	const extraAllowed = [
		...cliAllowRules(input),
		...Object.keys(input.mcpServers ?? {}).map((name) => `mcp__${name}`),
	];
	return extraAllowed.length > 0
		? [...new Set([...(reportAllowed ?? []), ...extraAllowed])]
		: reportAllowed;
}

/**
 * Claude Code's session knobs. The report follows the permission mode: plan
 * mode runs no tools, so the agent reports in text there. The adapter maps
 * `reasoning` for the models it knows; `effortEnv` covers the rest.
 */
export const CLAUDE_CODE_SPEC: HarnessSpec = {
	profile: CLAUDE_CODE_PROFILE,
	report: "by-mode",
	reasoningFor: () => true,
	// Claude Code then uses the user's own `claude login`.
	scrubEnv: ["ANTHROPIC_API_KEY"],
	// Sourced before each shell command: the step's CLI tools stay first on PATH.
	shellEnvFile: "CLAUDE_ENV_FILE",
};

/**
 * The `claude` adapter of one session, with its `--mcp-config` temp file.
 * The adapter package loads on the first session, not when Night Shift
 * starts.
 */
async function claudeCodeAdapter(
	input: AgentSessionInput,
	options: ClaudeCodeHarnessOptions,
	report: SessionReport,
): Promise<AdapterSetup> {
	const { claudeCodeText } = await import("@tanstack/ai-claude-code");
	const executable = options.claudeExecutable ?? "claude";
	const showThinking = await claudeKnowsThinkingDisplay(executable);
	const mcp = await writeMcpConfig(input.mcpServers);
	const allowedTools = claudeAllowedTools(input, report.allowedTools);
	const disallowedTools = claudeDisallowedTools(input, options.disallowedTools);
	// Typed as `opus`, the model with every Effort level, so `chat()` accepts
	// any `reasoning` level. The adapter gets the real id and clamps the level
	// to that model's own levels at runtime.
	const adapter = claudeCodeText(input.model as "opus", {
		authMode: "host",
		// The adapter's type lists four modes but passes the string to
		// `claude --permission-mode` as is, so `auto` works.
		permissionMode: input.permissionMode as "default",
		settingSources: options.settingSources ?? ["user", "project", "local"],
		emitDiff: false,
		...(allowedTools ? { allowedTools } : {}),
		...(disallowedTools ? { disallowedTools } : {}),
		// Folders it may read outside the worktree: `--add-dir`.
		...(input.addDirs && input.addDirs.length > 0
			? { addDirs: input.addDirs }
			: {}),
		claudeExecutable: claudeCommand(
			executable,
			mcp.path,
			input.readOnly === true,
			input.maxBudgetUsd,
			showThinking,
		),
		// The adapter passes it as `--max-turns`; Claude Code ends with
		// `error_max_turns` (`limit: "turns"`).
		...(input.maxTurns !== undefined ? { maxTurns: input.maxTurns } : {}),
		env: {
			...effortEnv(input.model, input.effort, (model) =>
				KNOWN_REASONING_MODELS.has(model),
			),
			// A subagent's text and thinking reach the stream too (Claude Code
			// 2.1.211 and later; older ones ignore it). The profile reads them.
			CLAUDE_CODE_FORWARD_SUBAGENT_TEXT: "1",
			...options.env,
		},
	});
	return { adapter, cleanup: mcp.cleanup };
}

/** Runs Claude Code sessions through TanStack AI, on the host, in `input.cwd`. */
export function claudeCodeHarness(
	options: ClaudeCodeHarnessOptions = {},
): AgentHarness {
	return {
		name: "claude-code",
		...harnessFacts("claude-code"),
		run: (raw) => {
			const input = readOnlyInput(raw);
			return harnessSession({
				input,
				spec: CLAUDE_CODE_SPEC,
				adapter: (report) => claudeCodeAdapter(input, options, report),
				...(options.allowedTools ? { allowedTools: options.allowedTools } : {}),
				...(options.abortGraceMs !== undefined
					? { abortGraceMs: options.abortGraceMs }
					: {}),
			});
		},
	};
}
