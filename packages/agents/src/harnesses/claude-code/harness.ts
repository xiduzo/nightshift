/**
 * The Claude Code harness: one `claude` process per session, driven through
 * `@tanstack/ai-claude-code` on the shared harness session
 * (`session/adapter-session.ts`). This file holds what is Claude Code's own: the
 * effort env for models the adapter does not know, the `--allowedTools`
 * rules for CLI tools and MCP servers, and the `--mcp-config` temp file.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ClaudeCodeSettingSource,
	claudeCodeText,
} from "@tanstack/ai-claude-code";
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
	type SessionReport,
} from "../../session";
import { harnessFacts } from "../facts";
import { CLAUDE_CODE_PROFILE } from "./profile";

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
 */
export function claudeCommand(
	executable: string | undefined,
	mcpConfigPath?: string,
): string {
	return [
		executable ?? "claude",
		...(mcpConfigPath !== undefined ? ["--mcp-config", mcpConfigPath] : []),
	].join(" ");
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
};

/** The `claude` adapter of one session, with its `--mcp-config` temp file. */
async function claudeCodeAdapter(
	input: AgentSessionInput,
	options: ClaudeCodeHarnessOptions,
	report: SessionReport,
): Promise<AdapterSetup> {
	const mcp = await writeMcpConfig(input.mcpServers);
	const allowedTools = claudeAllowedTools(input, report.allowedTools);
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
		...(options.disallowedTools
			? { disallowedTools: options.disallowedTools }
			: {}),
		claudeExecutable: claudeCommand(options.claudeExecutable, mcp.path),
		env: {
			...effortEnv(input.model, input.effort, (model) =>
				KNOWN_REASONING_MODELS.has(model),
			),
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
		run: (input) =>
			harnessSession({
				input,
				spec: CLAUDE_CODE_SPEC,
				adapter: (report) => claudeCodeAdapter(input, options, report),
				...(options.allowedTools ? { allowedTools: options.allowedTools } : {}),
				...(options.abortGraceMs !== undefined
					? { abortGraceMs: options.abortGraceMs }
					: {}),
			}),
	};
}
