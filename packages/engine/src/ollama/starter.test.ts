import { describe, expect, test } from "bun:test";
import { createOllamaStarter, type OllamaChild } from "./starter";

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
