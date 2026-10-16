import { randomUUID } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
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
	GITHUB_TOOL_IDS,
	type GithubToolsOptions,
	githubTools,
} from "./github";
import { streamSession } from "./session-stream";
import { reportStepTool, stepReportSetup } from "./step-report";
import { createTranslator, type Translator } from "./translate";
import type {
	AgentEvent,
	AgentHarness,
	AgentSessionInput,
	Effort,
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
	/** Turn `report_step` calls into `report` events. */
	stepReport: boolean;
	/**
	 * Turn off every built-in tool (`--tools ""`) and every MCP server but the
	 * bridge (`--strict-mcp-config`): the bridged tools are the only tools.
	 */
	bridgedToolsOnly?: boolean;
	/** Settings tiers to load (`--setting-sources`). */
	settingSources: ClaudeCodeSettingSource[];
	/** `--max-turns`. */
	maxTurns?: number;
};

/** The marker file the sandbox middleware writes into the workspace root. */
const PROJECTION_MARKER_PREFIX = ".tanstack-projected-";

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

/** Remove the sandbox marker so the worktree stays clean. Best effort. */
async function removeProjectionMarkers(dir: string): Promise<void> {
	try {
		const entries = await readdir(dir);
		await Promise.all(
			entries
				.filter((name) => name.startsWith(PROJECTION_MARKER_PREFIX))
				.map((name) => rm(join(dir, name), { force: true })),
		);
	} catch {
		// The directory is gone or unreadable: nothing to clean.
	}
}

/** A logger that feeds the raw Claude Code messages to the translator. */
function sdkTap(translator: Translator) {
	const ignore = () => {};
	return {
		logger: {
			debug: (_message: string, meta?: Record<string, unknown>) => {
				if (meta && "chunk" in meta) translator.observeSdk(meta.chunk);
			},
			info: ignore,
			warn: ignore,
			error: ignore,
		},
		provider: true,
		output: false,
		middleware: false,
		tools: false,
		agentLoop: false,
		config: false,
		errors: false,
		request: false,
		sandbox: false,
	};
}

/**
 * The `claude` command for `claudeExecutable`. The adapter splits that value
 * on spaces into argv (no shell) and puts it before its own flags. It only
 * passes `--tools "" --strict-mcp-config` itself for `toolChoice: 'none'` or
 * a named tool, and then bridges at most that one tool. A session that needs
 * several bridged tools and no built-in ones adds the flags here: the trailing
 * space makes the empty `--tools` value.
 */
export function claudeCommand(
	executable: string | undefined,
	bridgedToolsOnly: boolean | undefined,
): string {
	const command = executable ?? "claude";
	return bridgedToolsOnly ? `${command} --strict-mcp-config --tools ` : command;
}

function startChat(
	input: SessionRunInput,
	setup: SessionSetup,
	options: ClaudeCodeProcessOptions,
	translator: Translator,
	abortController: AbortController,
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
		debug: sdkTap(translator),
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
	const abortController = new AbortController();
	const forwardAbort = () => abortController.abort(input.signal.reason);
	if (input.signal.aborted) forwardAbort();
	else input.signal.addEventListener("abort", forwardAbort, { once: true });

	// Start lazily so a synchronous throw from chat() becomes a stream error.
	async function* chunks(): AsyncGenerator<unknown> {
		yield* startChat(input, setup, options, translator, abortController);
	}

	let ended = false;
	try {
		for await (const event of streamSession({
			chunks: chunks(),
			translator,
			signal: input.signal,
			...(options.abortGraceMs !== undefined
				? { abortGraceMs: options.abortGraceMs }
				: {}),
		})) {
			if (event.type === "finished" || event.type === "error") ended = true;
			yield event;
		}
	} finally {
		input.signal.removeEventListener("abort", forwardAbort);
		// The consumer stopped early: stop the claude process too.
		if (!ended) abortController.abort();
		await removeProjectionMarkers(input.cwd);
	}
}

/** The setup of an agent session: its prompt, the report tool, and the tool sets. */
export function harnessSetup(
	input: AgentSessionInput,
	options: ClaudeCodeHarnessOptions,
): SessionSetup {
	const report = stepReportSetup(input, options.allowedTools);
	const github = input.tools?.includes("github")
		? githubTools({ ...options.github, cwd: input.cwd })
		: [];
	const allowedTools =
		github.length > 0
			? [...new Set([...(report.allowedTools ?? []), ...GITHUB_TOOL_IDS])]
			: report.allowedTools;
	return {
		prompt: report.prompt,
		tools: [...(report.withTool ? [reportStepTool()] : []), ...github],
		allowedTools,
		...(options.disallowedTools
			? { disallowedTools: options.disallowedTools }
			: {}),
		stepReport: input.stepReport === true,
		settingSources: options.settingSources ?? ["user", "project", "local"],
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
