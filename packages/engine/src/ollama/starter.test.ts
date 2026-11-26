import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	bunSpawn,
	createOllamaStarter,
	killStartedOllama,
	type OllamaChild,
} from "./starter";

/** A fake `ollama serve`: it ends when it is killed or when the test ends it. */
function fakeChild(output: string[] = []) {
	let end!: (code: number | null) => void;
	const exited = new Promise<number | null>((resolve) => {
		end = resolve;
	});
	const signals: string[] = [];
	const child: OllamaChild = {
		exited,
		kill: (signal) => {
			signals.push(signal ?? "SIGTERM");
			end(null);
		},
		stderr: new ReadableStream({
			start(controller) {
				for (const line of output)
					controller.enqueue(new TextEncoder().encode(`${line}\n`));
				controller.close();
			},
		}),
	};
	return { child, end, signals };
}

function harness(options: { binary?: string | null; answers?: boolean } = {}) {
	const spawned: { argv: string[]; env: Record<string, string> }[] = [];
	const children: ReturnType<typeof fakeChild>[] = [];
	const logged: string[] = [];
	let up = 0;
	const state = { answers: options.answers ?? false, output: [] as string[] };
	const starter = createOllamaStarter({
		binary: () =>
			options.binary === undefined ? "/usr/bin/ollama" : options.binary,
		spawn: (argv, { env }) => {
			spawned.push({ argv, env });
			const made = fakeChild(state.output);
			children.push(made);
			// The child answers once it runs.
			state.answers = true;
			void made.child.exited.then(() => {
				state.answers = false;
			});
			return made.child;
		},
		answers: async () => state.answers,
		env: { PATH: "/usr/bin", HOME: "/home/bun", OLLAMA_HOST: "elsewhere:1" },
		modelsDir: "/data/ollama",
		host: "127.0.0.1:11434",
		onUp: () => {
			up += 1;
		},
		log: (line) => logged.push(line),
		firstWaitMs: 5,
		maxWaitMs: 20,
		stableMs: 10_000,
		stopWaitMs: 50,
	});
	return {
		starter,
		spawned,
		children,
		logged,
		state,
		up: () => up,
	};
}

const until = async (check: () => boolean) => {
	for (let i = 0; i < 200 && !check(); i++) await Bun.sleep(5);
	expect(check()).toBe(true);
};

describe("the Ollama starter", () => {
	test("starts ollama serve with its models in the data folder, on this computer's address", async () => {
		const h = harness();
		h.starter.start();
		await until(() => h.starter.up());
		expect(h.spawned).toHaveLength(1);
		expect(h.spawned[0]?.argv).toEqual(["/usr/bin/ollama", "serve"]);
		expect(h.spawned[0]?.env).toMatchObject({
			PATH: "/usr/bin",
			HOME: "/home/bun",
			OLLAMA_HOST: "127.0.0.1:11434",
			OLLAMA_MODELS: "/data/ollama",
		});
		expect(h.up()).toBe(1);
		// A second start while it runs starts nothing.
		h.starter.start();
		await Bun.sleep(20);
		expect(h.spawned).toHaveLength(1);
		await h.starter.stop();
	});

	test("starts it again with a growing wait when it ends", async () => {
		const h = harness();
		h.starter.start();
		await until(() => h.starter.up());
		h.children[0]?.end(1);
		await until(() => h.spawned.length === 2 && h.starter.up());
		h.children[1]?.end(2);
		await until(() => h.spawned.length === 3 && h.starter.up());
		expect(h.logged.filter((line) => line.includes("stopped"))).toEqual([
			"[ollama] Ollama stopped (exit 1). Night Shift starts it again in 0 s.",
			"[ollama] Ollama stopped (exit 2). Night Shift starts it again in 0 s.",
		]);
		expect(h.up()).toBe(3);
		await h.starter.stop();
	});

	test("stops it, and waits until it ended", async () => {
		const h = harness();
		h.starter.start();
		await until(() => h.starter.up());
		await h.starter.stop();
		expect(h.children[0]?.signals).toEqual(["SIGTERM"]);
		expect(h.starter.up()).toBe(false);
		expect(h.starter.wanted()).toBe(false);
		await Bun.sleep(30);
		expect(h.spawned).toHaveLength(1);
	});

	test("starts none while another Ollama answers on this computer", async () => {
		const h = harness({ answers: true });
		h.starter.start();
		await Bun.sleep(30);
		expect(h.spawned).toHaveLength(0);
		// It went away: Night Shift starts its own.
		h.state.answers = false;
		await until(() => h.spawned.length === 1);
		await h.starter.stop();
	});

	test("starts none without an ollama program", async () => {
		const h = harness({ binary: null });
		h.starter.start();
		await Bun.sleep(20);
		expect(h.spawned).toHaveLength(0);
		expect(h.logged).toEqual([
			"[ollama] Night Shift did not start Ollama: no ollama program on PATH.",
		]);
		await h.starter.stop();
	});

	test("writes only the child's errors to the log, with a prefix", async () => {
		const h = harness();
		h.state.output = [
			'time=2026-10-31T10:00:00Z level=INFO source=routes.go msg="Listening on 127.0.0.1:11434"',
			'time=2026-10-31T10:00:01Z level=ERROR source=server.go msg="model failed to load"',
			"[GIN] 2026/10/31 - 10:00:02 | 200 | GET /api/tags",
		];
		h.starter.start();
		await until(() => h.logged.length === 1);
		expect(h.logged).toEqual([
			'[ollama] time=2026-10-31T10:00:01Z level=ERROR source=server.go msg="model failed to load"',
		]);
		await h.starter.stop();
	});
});

describe("a stop while the starter asks whether an Ollama answers", () => {
	/** A starter whose question takes `ms`, and ends early on an abort when `hears` says so. */
	function asking(ms: number, hears: boolean) {
		const asked: AbortSignal[] = [];
		const starter = createOllamaStarter({
			binary: () => "/usr/bin/ollama",
			spawn: () => {
				throw new Error("Another Ollama answers: none starts.");
			},
			answers: (signal) => {
				asked.push(signal);
				return new Promise<boolean>((resolve) => {
					const timer = setTimeout(() => resolve(true), ms);
					if (!hears) return;
					signal.addEventListener("abort", () => {
						clearTimeout(timer);
						resolve(false);
					});
				});
			},
			env: {},
			modelsDir: "/data/ollama",
			host: "127.0.0.1:11434",
			log: () => {},
			maxWaitMs: 60_000,
		});
		return { starter, asked };
	}

	test("aborts the question, and ends at once", async () => {
		const { starter, asked } = asking(10_000, true);
		starter.start();
		await Bun.sleep(10);
		const since = performance.now();
		await starter.stop();
		expect(asked[0]?.aborted).toBe(true);
		expect(performance.now() - since).toBeLessThan(500);
	}, 5_000);

	test("a start after a stop asks again, with a question it does not abort", async () => {
		const { starter, asked } = asking(10_000, true);
		starter.start();
		await Bun.sleep(10);
		await starter.stop();
		starter.start();
		await Bun.sleep(10);
		expect(asked.at(-1)?.aborted).toBe(false);
		await starter.stop();
	}, 5_000);

	test("does not wait for the next question when the answer comes after the stop", async () => {
		const { starter } = asking(100, false);
		starter.start();
		await Bun.sleep(10);
		const since = performance.now();
		await starter.stop();
		expect(performance.now() - since).toBeLessThan(1_000);
	}, 5_000);
});

test("a child that does not end on SIGTERM is killed within the 2 s a daemon's stop may take", async () => {
	const signals: (NodeJS.Signals | undefined)[] = [];
	let running = false;
	let end = () => {};
	const starter = createOllamaStarter({
		binary: () => "/usr/bin/ollama",
		spawn: () => {
			running = true;
			const exited = new Promise<number | null>((resolve) => {
				end = () => resolve(null);
			});
			return {
				exited,
				kill: (signal) => {
					signals.push(signal);
					if (signal === "SIGKILL") end();
				},
			};
		},
		answers: async () => running,
		env: {},
		modelsDir: "/data/ollama",
		host: "127.0.0.1:11434",
		log: () => {},
	});
	starter.start();
	for (let i = 0; i < 200 && !starter.up(); i++) await Bun.sleep(5);
	const since = performance.now();
	await starter.stop();
	expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
	expect(performance.now() - since).toBeLessThan(2_000);
}, 10_000);

describe("`ollama serve` as Bun starts it", () => {
	// A server that ignores SIGTERM, and a runner of its own that does too.
	const SERVER = `trap "" TERM; (trap "" TERM; sleep 10) & echo $! > "$RUNNER"; wait`;

	test("a kill ends its runners too: none stays behind", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nightshift-ollama-"));
		try {
			const runnerFile = join(dir, "runner");
			const child = bunSpawn(["sh", "-c", SERVER], {
				env: { PATH: process.env.PATH ?? "/usr/bin:/bin", RUNNER: runnerFile },
			});
			let runner = 0;
			for (let i = 0; i < 100 && !runner; i++) {
				await Bun.sleep(20);
				runner = Number(
					(
						await Bun.file(runnerFile)
							.text()
							.catch(() => "")
					).trim(),
				);
			}
			expect(runner).toBeGreaterThan(0);
			child.kill("SIGKILL");
			await child.exited;
			let alive = true;
			for (let i = 0; i < 50 && alive; i++) {
				await Bun.sleep(20);
				try {
					process.kill(runner, 0);
				} catch {
					alive = false;
				}
			}
			expect(alive).toBe(false);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}, 10_000);
});

describe("a stop at once, when Night Shift must end now", () => {
	// A server with a runner of its own, both until they are killed.
	const SERVER = `(sleep 30) & echo $! > "$RUNNER"; wait`;
	/** The started servers, until they end, and the runners, until a test saw them end. */
	let servers: { kill(signal: NodeJS.Signals): void; ended: boolean }[] = [];
	let runners = new Set<number>();
	let others: Bun.Subprocess[] = [];
	afterEach(() => {
		for (const server of servers) if (!server.ended) server.kill("SIGKILL");
		servers = [];
		for (const pid of runners) if (alive(pid)) process.kill(pid, "SIGKILL");
		runners = new Set();
		for (const other of others) {
			if (other.exitCode === null && other.signalCode === null)
				other.kill("SIGKILL");
		}
		others = [];
	});

	function serve(runnerFile: string) {
		const child = bunSpawn(["sh", "-c", SERVER], {
			env: { PATH: process.env.PATH ?? "/usr/bin:/bin", RUNNER: runnerFile },
		});
		const server = { kill: child.kill, ended: false };
		void child.exited.then(() => {
			server.ended = true;
		});
		servers.push(server);
		return child;
	}

	const alive = (pid: number) => {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	};
	async function gone(pid: number): Promise<boolean> {
		for (let i = 0; i < 50 && alive(pid); i++) await Bun.sleep(20);
		if (alive(pid)) return false;
		runners.delete(pid);
		return true;
	}
	async function readPid(file: string): Promise<number> {
		for (let i = 0; i < 100; i++) {
			const pid = Number(
				(
					await Bun.file(file)
						.text()
						.catch(() => "")
				).trim(),
			);
			if (pid > 0) return pid;
			await Bun.sleep(20);
		}
		throw new Error(`no pid in ${file}`);
	}

	test("it ends the `ollama serve` Night Shift started, and its runners", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nightshift-ollama-"));
		try {
			const runnerFile = join(dir, "runner");
			const child = serve(runnerFile);
			const runner = await readPid(runnerFile);
			runners.add(runner);
			killStartedOllama();
			await child.exited;
			expect(await gone(runner)).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}, 10_000);

	test("after a stop, it kills nothing: the group is no longer Night Shift's", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nightshift-ollama-"));
		try {
			const runnerFile = join(dir, "runner");
			const child = serve(runnerFile);
			const runner = await readPid(runnerFile);
			runners.add(runner);
			child.kill("SIGKILL");
			await child.exited;
			expect(await gone(runner)).toBe(true);
			// A program of someone else, in a group of its own.
			const other = Bun.spawn(["sleep", "30"], { detached: true });
			others.push(other);
			const killed = spyOn(process, "kill");
			try {
				killStartedOllama();
				expect(killed).not.toHaveBeenCalled();
			} finally {
				killed.mockRestore();
			}
			expect(other.exitCode).toBeNull();
			expect(other.signalCode).toBeNull();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}, 10_000);
});
