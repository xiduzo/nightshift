/**
 * What every TanStack AI harness session shares: the raw-message tap on the
 * adapter's provider log, abort forwarding, and the stream contract (see
 * `session-stream.ts`). Each harness (`claude-code.ts`, `opencode.ts`,
 * `codex.ts`) only starts its own `chat()`.
 */
import { readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { streamSession } from "./session-stream";
import type { Translator } from "./translate";
import type { AgentEvent } from "./types";

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
