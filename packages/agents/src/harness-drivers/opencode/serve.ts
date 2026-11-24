/**
 * How a session starts `opencode serve`: the adapter's command with the
 * session's executable and config, and the port that the server chose.
 */

import type { SandboxHandle, SandboxProvider } from "@tanstack/ai-sandbox";
import { shellQuoteAlways } from "../../port";

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

/** What `opencode serve` says once it listens, with the port it chose. */
const READY_LINE = /opencode server listening on https?:\/\/\S+:(\d+)\s*$/;

/** The output in whole lines, so the ready line comes with its port. `onPort` gets that port. */
async function* readyLines(
	output: AsyncIterable<string>,
	onPort: (port: number) => void,
): AsyncIterable<string> {
	let partial = "";
	for await (const chunk of output) {
		const lines = (partial + chunk).split("\n");
		partial = lines.pop() ?? "";
		for (const line of lines) {
			const port = READY_LINE.exec(line)?.[1];
			if (port !== undefined) onPort(Number(port));
			yield `${line}\n`;
		}
	}
	if (partial) yield partial;
}

/**
 * A sandbox provider whose handles run `spawn` commands through `rewrite`,
 * and stop a spawned process only `killAfterAbortMs` after an abort. Port 0
 * of a handle is the port that its server said it listens on.
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
		let served: number | undefined;
		const ports: SandboxHandle["ports"] = {
			connect: async (port) => {
				if (port !== 0) return handle.ports.connect(port);
				if (served === undefined)
					throw new Error("OpenCode did not say which port it listens on.");
				return handle.ports.connect(served);
			},
		};
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
				return {
					pid: spawned.pid,
					stdout: readyLines(spawned.stdout, (port) => {
						served = port;
					}),
					stderr: spawned.stderr,
					stdin: spawned.stdin,
					wait: () => spawned.wait(),
					kill: (signal) => spawned.kill(signal),
				};
			},
		};
		return new Proxy(handle, {
			get(target, prop) {
				if (prop === "process") return process;
				if (prop === "ports") return ports;
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
