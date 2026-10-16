import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chat } from "@tanstack/ai";
import {
	type ClaudeCodeSettingSource,
	claudeCodeText,
} from "@tanstack/ai-claude-code";
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
} from "./adapter-session";
import {
	GITHUB_TOOL_IDS,
	type GithubToolsOptions,
	githubTools,
} from "./github";
import { reportStepTool, stepReportSetup } from "./step-report";
import { createTranslator, type Translator } from "./translate";
import type {
	AgentEvent,
	AgentHarness,
	AgentSessionInput,
	Effort,
	McpServerConfig,
	StepReportSpec,
} from "./types";

/** How a `claude` process is started. Shared by the harness and the decider. */
export type ClaudeCodeProcessOptions = {
	/** Path or name of the `claude` executable. Defaults to `claude`. */
	claudeExecutable?: string;
	/** Extra environment variables for the `claude` process. */
	env?: Record<string, string>;
	/** How long to wait for the process to stop after an abort. Default 5 s. */
	abortGraceMs?: number;
	/** How the GitHub tools run `gh` and `git` (tests use fakes). */
	github?: Omit<GithubToolsOptions, "cwd">;
};

export type ClaudeCodeHarnessOptions = ClaudeCodeProcessOptions & {
	/**
	 * Built-in tools the session may use without a prompt (`--allowedTools`).
	 * With `stepReport`, the report tool is added (see `step-report.ts`); with
	 * the `github` tool set, the GitHub tools are added (see `github.ts`).
	 */
	allowedTools?: string[];
	/** Built-in tools removed from the session (`--disallowedTools`). */
	disallowedTools?: string[];
	/** Settings tiers to load. Defaults to all three, like the `claude` CLI. */
	settingSources?: ClaudeCodeSettingSource[];
};

/** The parts of a session input that start the process. */
export type SessionRunInput = Pick<
	AgentSessionInput,
	"cwd" | "model" | "permissionMode" | "effort" | "resumeSessionId" | "signal"
>;

/** A TanStack AI server tool, as `chat({ tools })` takes it. */
export type SessionTool = NonNullable<
	Parameters<typeof chat>[0]["tools"]
>[number];

/** What one session sends: the prompt, the bridged tools, and the CLI settings. */
export type SessionSetup = {
	prompt: string;
	/** TanStack AI tools, bridged into the session over MCP. */
	tools: SessionTool[];
	/** `--allowedTools`: tools that run without a permission prompt. */
	allowedTools: string[] | undefined;
	/** `--disallowedTools`. */
	disallowedTools?: string[];
	/** Turn `report_step` calls into `report` events (`true` or a spec). */
	stepReport: boolean | StepReportSpec;
	/**
	 * Turn off every built-in tool (`--tools ""`) and every MCP server but the
	 * bridge (`--strict-mcp-config`): the bridged tools are the only tools.
	 */
	bridgedToolsOnly?: boolean;
	/** Settings tiers to load (`--setting-sources`). */
	settingSources: ClaudeCodeSettingSource[];
	/** `--max-turns`. */
	maxTurns?: number;
	/** The session's own MCP servers, next to the bridge (`--mcp-config`). */
	mcpServers?: Record<string, McpServerConfig>;
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
 * on spaces into argv (no shell) and puts it before its own flags. It only
 * passes `--tools "" --strict-mcp-config` itself for `toolChoice: 'none'` or
 * a named tool, and then bridges at most that one tool. A session that needs
 * several bridged tools and no built-in ones adds the flags here: the trailing
 * space makes the empty `--tools` value.
 *
 * `mcpConfigPath` adds the session's own MCP servers with `--mcp-config`.
 * The adapter passes its bridge with a second `--mcp-config`; the flag is
 * variadic, and Claude Code loads the servers of both.
 */
export function claudeCommand(
	executable: string | undefined,
	bridgedToolsOnly: boolean | undefined,
	mcpConfigPath?: string,
): string {
	const command = [
		executable ?? "claude",
		...(mcpConfigPath !== undefined ? ["--mcp-config", mcpConfigPath] : []),
	].join(" ");
	return bridgedToolsOnly ? `${command} --strict-mcp-config --tools ` : command;
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

function startChat(
	input: SessionRunInput,
	setup: SessionSetup,
	options: ClaudeCodeProcessOptions,
	translator: Translator,
	abortController: AbortController,
	mcpConfigPath: string | undefined,
): AsyncIterable<unknown> {
	// One id per session: the sandbox middleware keys its in-memory instances
	// by sandbox id and thread id, so concurrent sessions never share one.
	const id = `nightshift-${randomUUID()}`;
	const sandbox = defineSandbox({
		id,
		provider: localProcessSandbox({
			dir: input.cwd,
			// Never delete the run's worktree when the sandbox is destroyed.
			removeOnDestroy: false,
			// Claude Code then uses the user's own `claude login`.
			scrubEnv: ["ANTHROPIC_API_KEY"],
		}),
		fileEvents: false,
		// Required: the adapter reads the workspace projection. With a
		// local-process `dir`, the virtual `/workspace` is `input.cwd`. The
		// relative root keeps the projection marker at the top of `input.cwd`:
		// the default root writes it under `<cwd>/<cwd>/`.
		workspace: defineWorkspace({ source: localSource(input.cwd), root: "." }),
		lifecycle: { reuse: "none", destroyOnComplete: true },
	});

	// Typed as `opus`, the model with every Effort level, so `chat()` accepts
	// any `reasoning` level. The adapter gets the real id and clamps the level
	// to that model's own levels at runtime.
	const adapter = claudeCodeText(input.model as "opus", {
		authMode: "host",
		// The adapter's type lists four modes but passes the string to
		// `claude --permission-mode` as is, so `auto` works.
		permissionMode: input.permissionMode as "default",
		settingSources: setup.settingSources,
		emitDiff: false,
		...(setup.allowedTools ? { allowedTools: setup.allowedTools } : {}),
		...(setup.disallowedTools
			? { disallowedTools: setup.disallowedTools }
			: {}),
		...(setup.maxTurns !== undefined ? { maxTurns: setup.maxTurns } : {}),
		claudeExecutable: claudeCommand(
			options.claudeExecutable,
			setup.bridgedToolsOnly,
			mcpConfigPath,
		),
		env: {
			...effortEnv(input.model, input.effort, (model) =>
				KNOWN_REASONING_MODELS.has(model),
			),
			...options.env,
		},
	});

	return chat({
		adapter,
		threadId: id,
		messages: [{ role: "user", content: setup.prompt }],
		...(setup.tools.length > 0 ? { tools: setup.tools } : {}),
		...(input.resumeSessionId
			? { modelOptions: { sessionId: input.resumeSessionId } }
			: {}),
		...(input.effort ? { reasoning: { level: input.effort } } : {}),
		middleware: [withSandbox(sandbox)],
		abortController,
		debug: providerTap(translator),
	}) as AsyncIterable<unknown>;
}

/**
 * Run one `claude` process through `chat()` and the sandbox middleware, and
 * translate its stream into AgentEvent values. Never throws.
 */
export async function* runClaudeCodeSession(
	input: SessionRunInput,
	setup: SessionSetup,
	options: ClaudeCodeProcessOptions,
): AsyncGenerator<AgentEvent> {
	const translator = createTranslator({
		// Only used when Claude Code fails before it reports its session id.
		fallbackSessionId: input.resumeSessionId ?? randomUUID(),
		stepReport: setup.stepReport,
	});
	let removeMcpConfig = async () => {};
	yield* runAdapterSession({
		signal: input.signal,
		translator,
		start: async function* (abortController) {
			const mcp = await writeMcpConfig(setup.mcpServers);
			removeMcpConfig = mcp.cleanup;
			yield* startChat(
				input,
				setup,
				options,
				translator,
				abortController,
				mcp.path,
			);
		},
		...(options.abortGraceMs !== undefined
			? { abortGraceMs: options.abortGraceMs }
			: {}),
		cleanup: async () => {
			await removeMcpConfig();
			await removeProjectionMarkers(input.cwd);
		},
	});
}

/** The setup of an agent session: its prompt, the report tool, and the tool sets. */
export function harnessSetup(
	input: AgentSessionInput,
	options: ClaudeCodeHarnessOptions,
): SessionSetup {
	const report = stepReportSetup(input, options.allowedTools);
	const github = input.tools?.includes("github")
		? githubTools({
				...options.github,
				cwd: input.cwd,
				...(input.effects ? { effects: input.effects } : {}),
			})
		: [];
	const mcpServers = input.mcpServers ?? {};
	// The node lists its MCP servers on purpose, like its tool sets: their
	// tools run without a prompt (`mcp__<server>` allows every tool of it).
	const extraAllowed = [
		...(github.length > 0 ? GITHUB_TOOL_IDS : []),
		...Object.keys(mcpServers).map((name) => `mcp__${name}`),
	];
	const allowedTools =
		extraAllowed.length > 0
			? [...new Set([...(report.allowedTools ?? []), ...extraAllowed])]
			: report.allowedTools;
	return {
		prompt: report.prompt,
		tools: [
			...(report.withTool ? [reportStepTool(input.stepReport)] : []),
			...github,
		],
		allowedTools,
		...(options.disallowedTools
			? { disallowedTools: options.disallowedTools }
			: {}),
		stepReport: input.stepReport ?? false,
		settingSources: options.settingSources ?? ["user", "project", "local"],
		...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
	};
}

/** Runs Claude Code sessions through TanStack AI, on the host, in `input.cwd`. */
export function claudeCodeHarness(
	options: ClaudeCodeHarnessOptions = {},
): AgentHarness {
	return {
		name: "claude-code",
		run: (input) =>
			runClaudeCodeSession(input, harnessSetup(input, options), options),
	};
}
