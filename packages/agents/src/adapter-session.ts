/**
 * What every TanStack AI harness session shares: the raw-message tap on the
 * adapter's provider log, abort forwarding, and the stream contract (see
 * `session-stream.ts`). Each harness (`claude-code.ts`, `opencode.ts`,
 * `codex.ts`) only starts its own `chat()`.
 */
import { randomUUID } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import {
	defineSandbox,
	defineWorkspace,
	localSource,
	mcpSkill,
	type SandboxPolicy,
} from "@tanstack/ai-sandbox";
import { localProcessSandbox } from "@tanstack/ai-sandbox-local-process";
import { streamSession } from "./session-stream";
import type { Translator } from "./translate";
import type { AgentEvent, McpServerConfig } from "./types";

/**
 * The sandbox of one session on this computer: the local-process provider
 * in `cwd`, which it never deletes. `mcpServers` go into the workspace as
 * MCP skills: the ACP adapters (ACP agents, Grok Build) hand those to the
 * agent. They take URL servers only. Returns a problem text when a server
 * is a command. `policy` is for adapters that map it onto their own flags.
 */
export function hostSandbox(
	cwd: string,
	mcpServers: Record<string, McpServerConfig> = {},
	policy?: SandboxPolicy,
): { sandbox: ReturnType<typeof defineSandbox>; id: string } | string {
	const commands = Object.entries(mcpServers)
		.filter(([, server]) => !("url" in server))
		.map(([name]) => name);
	if (commands.length > 0) {
		return `This harness can use connections with a URL only. Remove ${commands.join(", ")} from the node, or run it on another harness.`;
	}
	const skills = Object.entries(mcpServers).map(([name, server]) =>
		mcpSkill(name, "url" in server ? { ...server } : {}),
	);
	// One id per session: the middleware keys its instances by sandbox id.
	const id = `nightshift-${randomUUID()}`;
	const sandbox = defineSandbox({
		id,
		provider: localProcessSandbox({ dir: cwd, removeOnDestroy: false }),
		fileEvents: false,
		// The relative root keeps the adapter's marker at the top of `cwd`.
		workspace: defineWorkspace({
			source: localSource(cwd),
			root: ".",
			...(skills.length > 0 ? { skills } : {}),
		}),
		lifecycle: { reuse: "none", destroyOnComplete: true },
		...(policy ? { policy } : {}),
	});
	return { sandbox, id };
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
 * Never throws.
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

/** Quote one value for `sh -c`. */
export function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
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
