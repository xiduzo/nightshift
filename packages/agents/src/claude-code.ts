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
import { streamSession } from "./session-stream";
import { reportStepTool, stepReportSetup } from "./step-report";
import { createTranslator, type Translator } from "./translate";
import type {
	AgentEvent,
	AgentHarness,
	AgentSessionInput,
	Effort,
} from "./types";

export type ClaudeCodeHarnessOptions = {
	/**
	 * Built-in tools the session may use without a prompt (`--allowedTools`).
	 * With `stepReport`, the report tool is added (see `step-report.ts`).
	 */
	allowedTools?: string[];
	/** Built-in tools removed from the session (`--disallowedTools`). */
	disallowedTools?: string[];
	/** Settings tiers to load. Defaults to all three, like the `claude` CLI. */
	settingSources?: ClaudeCodeSettingSource[];
	/** Path or name of the `claude` executable. Defaults to `claude`. */
	claudeExecutable?: string;
	/** Extra environment variables for the `claude` process. */
	env?: Record<string, string>;
	/** How long to wait for the process to stop after an abort. Default 5 s. */
	abortGraceMs?: number;
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

function startChat(
	input: AgentSessionInput,
	options: ClaudeCodeHarnessOptions,
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

	const report = stepReportSetup(input, options.allowedTools);

	// Typed as `opus`, the model with every Effort level, so `chat()` accepts
	// any `reasoning` level. The adapter gets the real id and clamps the level
	// to that model's own levels at runtime.
	const adapter = claudeCodeText(input.model as "opus", {
		authMode: "host",
		permissionMode: input.permissionMode,
		settingSources: options.settingSources ?? ["user", "project", "local"],
		emitDiff: false,
		...(report.allowedTools ? { allowedTools: report.allowedTools } : {}),
		...(options.disallowedTools
			? { disallowedTools: options.disallowedTools }
			: {}),
		...(options.claudeExecutable
			? { claudeExecutable: options.claudeExecutable }
			: {}),
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
		messages: [{ role: "user", content: report.prompt }],
		...(report.withTool ? { tools: [reportStepTool()] } : {}),
		...(input.resumeSessionId
			? { modelOptions: { sessionId: input.resumeSessionId } }
			: {}),
		...(input.effort ? { reasoning: { level: input.effort } } : {}),
		middleware: [withSandbox(sandbox)],
		abortController,
		debug: sdkTap(translator),
	}) as AsyncIterable<unknown>;
}

async function* runClaudeCode(
	input: AgentSessionInput,
	options: ClaudeCodeHarnessOptions,
): AsyncGenerator<AgentEvent> {
	const translator = createTranslator({
		// Only used when Claude Code fails before it reports its session id.
		fallbackSessionId: input.resumeSessionId ?? randomUUID(),
		stepReport: input.stepReport === true,
	});
	const abortController = new AbortController();
	const forwardAbort = () => abortController.abort(input.signal.reason);
	if (input.signal.aborted) forwardAbort();
	else input.signal.addEventListener("abort", forwardAbort, { once: true });

	// Start lazily so a synchronous throw from chat() becomes a stream error.
	async function* chunks(): AsyncGenerator<unknown> {
		yield* startChat(input, options, translator, abortController);
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

/** Runs Claude Code sessions through TanStack AI, on the host, in `input.cwd`. */
export function claudeCodeHarness(
	options: ClaudeCodeHarnessOptions = {},
): AgentHarness {
	return {
		name: "claude-code",
		run: (input) => runClaudeCode(input, options),
	};
}
