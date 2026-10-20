/**
 * One harness session behind every TanStack AI adapter.
 *
 * Night Shift runs an Agent step as one `chat()` call on a coding-agent CLI
 * (Claude Code, Codex, OpenCode, an ACP agent, Grok Build). This module is
 * the deep part of that: `harnessSession` owns the local-process sandbox in
 * `input.cwd`, the `chat()` call, the translator wiring, the step-report
 * setup, the session-id capture and the abort handling. An adapter file
 * supplies a `HarnessSpec` (the knobs that differ per harness) and an
 * adapter factory (`AdapterSetup`: its TanStack adapter and the few hooks it
 * needs on the sandbox), and keeps its raw-message observer.
 *
 * The seam between the two is `AdapterSetup`: everything an adapter must say
 * about its sandbox goes through it, so no adapter file calls
 * `defineSandbox` or `chat()` itself. The stream contract (one `session`
 * event first, one terminal event last, never throws) is `session-stream.ts`.
 */
import { randomUUID } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { type AnyTextAdapter, chat } from "@tanstack/ai";
import {
	defineSandbox,
	defineWorkspace,
	localSource,
	mcpSkill,
	type SandboxPolicy,
	type SandboxProvider,
	withSandbox,
} from "@tanstack/ai-sandbox";
import { localProcessSandbox } from "@tanstack/ai-sandbox-local-process";
import type { AgentEvent, AgentSessionInput, McpServerConfig } from "../port";
import { streamSession } from "./session-stream";
import { reportStepTool, stepReportSetup } from "./step-report";
import { withSharedToolBridge } from "./tool-bridge";
import {
	createTranslator,
	type HarnessProfile,
	type Translator,
} from "./translate";

/** A TanStack AI server tool, as `chat({ tools })` takes it. */
export type SessionTool = NonNullable<
	Parameters<typeof chat>[0]["tools"]
>[number];

/**
 * The session knobs of one harness: what `harnessSession` must know that
 * differs per harness. Translation knobs live in `profile` (`translate.ts`).
 */
export type HarnessSpec = {
	/** How the translator reads this harness's stream. */
	profile: HarnessProfile;
	/**
	 * How the agent reports a step (see `step-report.ts`):
	 * - `by-mode`: the bridged tool, except in plan mode, where the agent
	 *   writes a text line (Claude Code runs no tools in plan mode).
	 * - `tool`: the bridged tool in every mode, plan mode too: the harness
	 *   allows Night Shift's own tools without a prompt (Codex, OpenCode,
	 *   the ACP agents).
	 * - `text`: always a text line (Grok Build has no tool-call events).
	 */
	report: "by-mode" | "tool" | "text";
	/**
	 * `chat({ reasoning })` carries the effort for this model. Unset: never;
	 * the adapter sets the effort itself, or the harness has no level.
	 */
	reasoningFor?: (model: string) => boolean;
	/**
	 * The session's MCP servers go into the workspace as MCP skills, which
	 * the adapter hands to the agent (the ACP agents, Grok Build). URL
	 * servers only: a command server ends the session with an error.
	 */
	mcpAsSkills?: boolean;
	/**
	 * A resumed session may not announce its id again: the translator gets
	 * the id up front and emits `session` with the first chunk.
	 */
	resumeIsSilent?: boolean;
	/** Environment variables the harness process never sees. */
	scrubEnv?: string[];
};

/** What the step report adds to one session: the prompt, the tool, the allow rule. */
export type SessionReport = {
	prompt: string;
	/** `report_step`, bridged into the session over MCP, when the report uses it. */
	tools: SessionTool[];
	/** Claude Code's `--allowedTools`, with the report tool added. */
	allowedTools: string[] | undefined;
};

/**
 * What an adapter file hands back for one session: its TanStack adapter and
 * the hooks it needs on the shared sandbox. The seam of this module.
 */
export type AdapterSetup = {
	adapter: AnyTextAdapter;
	/**
	 * Wrap the local-process provider: OpenCode rewrites the adapter's
	 * `opencode serve` command on spawn.
	 */
	wrapProvider?: (provider: SandboxProvider) => SandboxProvider;
	/** A sandbox policy, for adapters that map it onto their own flags. */
	policy?: SandboxPolicy;
	/** Runs after the session, always: temp files, config the session made. */
	cleanup?: () => Promise<void>;
};

/**
 * The step report of one session, per the spec's `report`. Exported so an
 * adapter can compute its own allow rules from the same report.
 */
export function sessionReport(
	input: Pick<AgentSessionInput, "prompt" | "stepReport" | "permissionMode">,
	spec: Pick<HarnessSpec, "report" | "profile">,
	allowedTools?: string[],
): SessionReport {
	const permissionMode =
		spec.report === "by-mode"
			? input.permissionMode
			: spec.report === "tool"
				? "default"
				: "plan";
	const report = stepReportSetup(
		{ ...input, permissionMode },
		allowedTools,
		spec.profile.reportToolId,
	);
	return {
		prompt: report.prompt,
		tools: report.withTool ? [reportStepTool(input.stepReport)] : [],
		allowedTools: report.allowedTools,
	};
}

/**
 * The session's MCP servers as workspace skills. Returns a problem text when
 * a server is a command: the adapter can hand over URL servers only.
 */
function mcpSkills(
	mcpServers: Record<string, McpServerConfig> = {},
): ReturnType<typeof mcpSkill>[] | string {
	const commands = Object.entries(mcpServers)
		.filter(([, server]) => !("url" in server))
		.map(([name]) => name);
	if (commands.length > 0) {
		return `This harness can use connections with a URL only. Remove ${commands.join(", ")} from the node, or run it on another harness.`;
	}
	return Object.entries(mcpServers).map(([name, server]) =>
		mcpSkill(name, "url" in server ? { ...server } : {}),
	);
}

/**
 * Run one harness session and keep the AgentHarness contract. Never throws:
 * a throw from `adapter` (called lazily, once the stream is read) ends the
 * stream with an `error` event.
 */
export function harnessSession(options: {
	input: AgentSessionInput;
	spec: HarnessSpec;
	/** Build the TanStack adapter of this session, from its step report. */
	adapter: (report: SessionReport) => AdapterSetup | Promise<AdapterSetup>;
	/** Claude Code's `--allowedTools`; the report tool joins them. */
	allowedTools?: string[];
	/** How long to wait for the process to stop after an abort. Default 5 s. */
	abortGraceMs?: number;
}): AsyncGenerator<AgentEvent> {
	const { input, spec } = options;
	const translator = createTranslator({
		// Only used when the harness fails before it reports its session id.
		fallbackSessionId: input.resumeSessionId ?? randomUUID(),
		stepReport: input.stepReport ?? false,
		profile: spec.profile,
		...(spec.resumeIsSilent && input.resumeSessionId
			? { knownSessionId: input.resumeSessionId }
			: {}),
	});
	let cleanup = async () => {};
	return runAdapterSession({
		signal: input.signal,
		translator,
		start: async function* (abortController) {
			const skills = spec.mcpAsSkills ? mcpSkills(input.mcpServers) : [];
			if (typeof skills === "string") throw new Error(skills);
			const report = sessionReport(input, spec, options.allowedTools);
			const setup = await options.adapter(report);
			cleanup = setup.cleanup ?? cleanup;

			// One id per session: the sandbox middleware keys its in-memory
			// instances by sandbox id and thread id, so concurrent sessions
			// never share one.
			const id = `nightshift-${randomUUID()}`;
			const provider = localProcessSandbox({
				dir: input.cwd,
				// Never delete the run's worktree when the sandbox is destroyed.
				removeOnDestroy: false,
				...(spec.scrubEnv ? { scrubEnv: spec.scrubEnv } : {}),
			});
			const sandbox = defineSandbox({
				id,
				provider: setup.wrapProvider?.(provider) ?? provider,
				fileEvents: false,
				// Required: the adapters read the workspace projection. With a
				// local-process `dir`, the virtual `/workspace` is `input.cwd`.
				// The relative root keeps the projection marker at the top of
				// `input.cwd`: the default root writes it under `<cwd>/<cwd>/`.
				// Without skills the projection writes only that marker
				// (removed afterwards), never a config file.
				workspace: defineWorkspace({
					source: localSource(input.cwd),
					root: ".",
					...(skills.length > 0 ? { skills } : {}),
				}),
				lifecycle: { reuse: "none", destroyOnComplete: true },
				...(setup.policy ? { policy: setup.policy } : {}),
			});

			yield* chat({
				adapter: setup.adapter,
				threadId: id,
				messages: [{ role: "user", content: report.prompt }],
				...(report.tools.length > 0 ? { tools: report.tools } : {}),
				...(input.resumeSessionId
					? { modelOptions: { sessionId: input.resumeSessionId } }
					: {}),
				// The adapters type the level per known model; the spec says
				// which models take it, so the cast is safe.
				...(input.effort && spec.reasoningFor?.(input.model)
					? { reasoning: { level: input.effort } as never }
					: {}),
				middleware: [withSandbox(sandbox), withSharedToolBridge],
				abortController,
				debug: providerTap(translator),
			}) as AsyncIterable<unknown>;
		},
		...(options.abortGraceMs !== undefined
			? { abortGraceMs: options.abortGraceMs }
			: {}),
		cleanup: async () => {
			await cleanup();
			await removeProjectionMarkers(input.cwd);
		},
	});
}

/**
 * `chat({ debug })` that feeds the adapter's raw harness messages to the
 * translator. The adapters log each raw message at the `provider` category
 * as `{ chunk }`; every other category stays off.
 */
export function providerTap(translator: Translator) {
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
 * Run one adapter session and keep the AgentHarness contract. `start` gets
 * the abort controller to pass to `chat()`; it is called lazily, so a
 * synchronous throw becomes a stream error. `cleanup` runs last, always.
 * Never throws. The layer under `harnessSession`.
 */
export async function* runAdapterSession(options: {
	signal: AbortSignal;
	translator: Translator;
	start: (abortController: AbortController) => AsyncIterable<unknown>;
	abortGraceMs?: number;
	cleanup?: () => Promise<void>;
}): AsyncGenerator<AgentEvent> {
	const { signal, translator } = options;
	const abortController = new AbortController();
	const forwardAbort = () => abortController.abort(signal.reason);
	if (signal.aborted) forwardAbort();
	else signal.addEventListener("abort", forwardAbort, { once: true });

	async function* chunks(): AsyncGenerator<unknown> {
		yield* options.start(abortController);
	}

	let ended = false;
	try {
		for await (const event of streamSession({
			chunks: chunks(),
			translator,
			signal,
			...(options.abortGraceMs !== undefined
				? { abortGraceMs: options.abortGraceMs }
				: {}),
		})) {
			if (event.type === "finished" || event.type === "error") ended = true;
			yield event;
		}
	} finally {
		signal.removeEventListener("abort", forwardAbort);
		// The consumer stopped early: stop the harness process too.
		if (!ended) abortController.abort();
		await options.cleanup?.().catch(() => {});
	}
}

/** A free TCP port on 127.0.0.1, for a harness server of one session. */
export function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port =
				typeof address === "object" && address ? address.port : undefined;
			server.close(() =>
				port === undefined ? reject(new Error("No free port")) : resolve(port),
			);
		});
	});
}

/** The marker file the sandbox middleware writes into the workspace root. */
const PROJECTION_MARKER_PREFIX = ".tanstack-projected-";

/** Remove the sandbox marker so the worktree stays clean. Best effort. */
export async function removeProjectionMarkers(dir: string): Promise<void> {
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
