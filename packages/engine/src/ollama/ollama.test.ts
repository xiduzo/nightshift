import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createConnectionStore } from "../device-config/connections";
import { createSettingsStore } from "../device-config/settings";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { createOllama, type OllamaService } from "./ollama";
import type { OllamaChild } from "./starter";

let sandbox: Sandbox;
let services: OllamaService[] = [];
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await Promise.all(services.map((s) => s.stop()));
	services = [];
	await sandbox.cleanup();
});

/** `${NAME}`: a reference to a secret. */
const ref = (name: string) => `\${${name}}`;

/**
 * A fake Ollama behind `fetch`: it answers while `up`, has `models`, and
 * streams a download in three parts.
 */
function fakeOllama() {
	const state = {
		up: true,
		models: [] as { name: string; capabilities?: string[] }[],
		requests: [] as { url: string; headers: Headers }[],
	};
	const fetch: typeof globalThis.fetch = (async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		const url = new URL(String(input instanceof Request ? input.url : input));
		state.requests.push({ url: url.href, headers: new Headers(init?.headers) });
		if (!state.up) throw new TypeError("fetch failed: ECONNREFUSED");
		if (url.pathname === "/api/version")
			return Response.json({ version: "0.13.0" });
		if (url.pathname === "/api/tags")
			return Response.json({
				models: state.models.map((m) => ({
					name: m.name,
					model: m.name,
					size: 1000,
					digest: "d",
					details: {},
					...(m.capabilities ? { capabilities: m.capabilities } : {}),
				})),
			});
		if (url.pathname === "/api/pull") {
			const body = JSON.parse(String(init?.body)) as {
				model?: string;
				name?: string;
			};
			const model = body.model ?? body.name ?? "";
			const lines = [
				{ status: "pulling manifest" },
				{ status: "pulling a", digest: "a", total: 400, completed: 100 },
				{ status: "pulling b", digest: "b", total: 600, completed: 0 },
				{ status: "pulling a", digest: "a", total: 400, completed: 400 },
				{ status: "pulling b", digest: "b", total: 600, completed: 600 },
				{ status: "success" },
			];
			const encoder = new TextEncoder();
			return new Response(
				new ReadableStream({
					async start(controller) {
						for (const line of lines) {
							// Ollama has the model when it says success.
							if (line.status === "success")
								state.models.push({ name: model, capabilities: ["embedding"] });
							controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
							await Bun.sleep(5);
						}
						controller.close();
					},
				}),
			);
		}
		return new Response("not found", { status: 404 });
	}) as typeof globalThis.fetch;
	return { state, fetch };
}

async function harness(
	options: {
		env?: Record<string, string | undefined>;
		binary?: string | null;
		/** Whether an Ollama answers on this computer at the start. */
		up?: boolean;
	} = {},
) {
	const env = options.env ?? {};
	const document = await sandbox.openDocument();
	const settings = createSettingsStore({ document, env });
	const values = new Map<string, string>();
	const connections = createConnectionStore({
		document,
		env,
		secrets: {
			get: async (name) => values.get(name) ?? null,
			set: async (name, value) => {
				values.set(name, value);
			},
			delete: async (name) => {
				values.delete(name);
			},
		},
	});
	await Promise.all([settings.load(), connections.load()]);
	const ollama = fakeOllama();
	ollama.state.up = options.up ?? true;
	const spawned: string[][] = [];
	const service = await createOllama({
		dataDir: "/data",
		settings,
		secrets: connections,
		env: { PATH: "/usr/bin" },
		which: () =>
			options.binary === undefined ? "/usr/bin/ollama" : options.binary,
		spawn: (argv) => {
			spawned.push(argv);
			ollama.state.up = true;
			let end!: (code: number | null) => void;
			const child: OllamaChild = {
				exited: new Promise((resolve) => {
					end = resolve;
				}),
				kill: () => {
					ollama.state.up = false;
					end(null);
				},
			};
			return child;
		},
		fetch: ollama.fetch,
		log: () => {},
	});
	services.push(service);
	return { service, settings, connections, ollama, spawned };
}

const until = async (check: () => boolean | Promise<boolean>) => {
	for (let i = 0; i < 400 && !(await check()); i++) await Bun.sleep(5);
	expect(await check()).toBe(true);
};

describe("where Ollama is", () => {
	test("the owner's setting wins over OLLAMA_HOST, which wins over this computer", async () => {
		const plain = await harness();
		expect(plain.service.endpoint()).toMatchObject({
			address: "http://127.0.0.1:11434",
			where: null,
			from: "local",
		});

		const h = await harness({ env: { OLLAMA_HOST: "studio.local" } });
		expect(h.service.endpoint()).toMatchObject({
			address: "http://studio.local:11434",
			where: "studio.local",
			from: "env",
		});
		await h.settings.save({ ollamaAddress: "https://gpu.example.com/ollama" });
		await until(() => h.service.endpoint().from === "setting");
		expect(h.service.endpoint()).toMatchObject({
			address: "https://gpu.example.com/ollama",
			where: "gpu.example.com",
		});
	});

	test("headers take their secrets, and say which are missing", async () => {
		const h = await harness();
		await h.connections.setSecret("OLLAMA_TOKEN", "s3cret");
		await h.settings.save({
			ollamaAddress: "https://gpu.example.com",
			ollamaHeaders: {
				Authorization: `Bearer ${ref("OLLAMA_TOKEN")}`,
				"X-Team": "night",
			},
		});
		await until(() => h.service.endpoint().from === "setting");
		expect(h.service.endpoint()).toMatchObject({
			headers: { Authorization: "Bearer s3cret", "X-Team": "night" },
			secretValues: ["s3cret"],
			missing: [],
		});
		// The search's requests carry them.
		h.ollama.state.models = [{ name: "qwen3-embedding:0.6b" }];
		expect(await h.service.meaning()?.ready()).toBe("ready");
		const tags = h.ollama.state.requests.findLast((r) =>
			r.url.endsWith("/api/tags"),
		);
		expect(tags?.url).toBe("https://gpu.example.com/api/tags");
		expect(tags?.headers.get("authorization")).toBe("Bearer s3cret");

		await h.settings.save({
			ollamaHeaders: { Authorization: `Bearer ${ref("GONE")}` },
		});
		await until(() => h.service.endpoint().missing.length > 0);
		expect(h.service.endpoint()).toMatchObject({
			headers: {},
			secretValues: [],
			missing: ["GONE"],
		});
		expect((await h.service.status()).missingSecrets).toEqual(["GONE"]);

		// A saved secret applies at once.
		await h.connections.setSecret("GONE", "back");
		await until(() => h.service.endpoint().missing.length === 0);
		expect(h.service.endpoint().headers).toEqual({
			Authorization: "Bearer back",
		});
	});
});

describe("starting Ollama", () => {
	test("a Host starts it, and it downloads the model in the background", async () => {
		const h = await harness({ env: { NIGHTSHIFT_HOST: "on" }, up: false });
		await until(() => h.spawned.length === 1);
		expect(h.spawned[0]).toEqual(["/usr/bin/ollama", "serve"]);

		// The model downloads: search says how far, then it is ready.
		const seen = new Set<string>();
		await until(async () => {
			const meaning = h.service.meaning();
			const ready = (await meaning?.ready()) ?? "off";
			seen.add(ready);
			return ready === "ready";
		});
		expect(seen.has("downloading")).toBe(true);
		const status = await h.service.status();
		expect(status).toMatchObject({
			started: true,
			answers: true,
			model: "qwen3-embedding:0.6b",
			hasModel: true,
			where: null,
			from: "local",
			download: null,
		});
	});

	test("another computer starts it only when its owner turns it on", async () => {
		const h = await harness({ up: false });
		await Bun.sleep(30);
		expect(h.spawned).toHaveLength(0);
		await h.settings.save({ ollama: "on" });
		await until(() => h.spawned.length === 1);
		await h.settings.save({ ollama: "auto" });
		await until(() => !h.ollama.state.up);
	});

	test("an address, or off, starts none", async () => {
		const set = await harness({
			env: { NIGHTSHIFT_HOST: "on", OLLAMA_HOST: "http://studio.local:11434" },
			up: false,
		});
		const off = await harness({
			env: { NIGHTSHIFT_HOST: "on", NIGHTSHIFT_OLLAMA: "off" },
			up: false,
		});
		await Bun.sleep(30);
		expect(set.spawned).toHaveLength(0);
		expect(off.spawned).toHaveLength(0);
		expect(off.service.meaning()).toBeNull();
		expect(set.service.meaning()?.where).toBe("studio.local");
	});

	test("no ollama program starts none", async () => {
		const h = await harness({
			env: { NIGHTSHIFT_HOST: "on" },
			binary: null,
			up: false,
		});
		await Bun.sleep(30);
		expect(h.spawned).toHaveLength(0);
		expect((await h.service.status()).installed).toBe(false);
	});
});

describe("models", () => {
	test("NIGHTSHIFT_EMBEDDING_MODEL picks the model, and a saved one wins", async () => {
		const h = await harness({
			env: { NIGHTSHIFT_EMBEDDING_MODEL: "nomic-embed-text" },
		});
		expect(h.service.meaning()?.model).toBe("nomic-embed-text");
		await h.settings.save({ embeddingModel: "bge-m3" });
		expect(h.service.meaning()?.model).toBe("bge-m3");
	});

	test("lists the models that embed, and downloads one with its progress", async () => {
		const h = await harness();
		h.ollama.state.models = [
			{ name: "nomic-embed-text:latest", capabilities: ["embedding"] },
			{ name: "llama3.2:latest", capabilities: ["completion"] },
			{ name: "old-model:latest" },
		];
		expect(
			(await h.service.models()).map((m) => [m.name, m.embedding]),
		).toEqual([
			["nomic-embed-text:latest", true],
			["old-model:latest", null],
		]);

		const percents: number[] = [];
		await h.settings.save({ embeddingModel: "bge-m3" });
		expect((await h.service.status()).hasModel).toBe(false);
		h.service.pull("bge-m3");
		await until(async () => {
			const download = (await h.service.status()).download;
			if (download?.running) percents.push(download.percent);
			return h.ollama.state.models.some((m) => m.name === "bge-m3");
		});
		await until(async () => (await h.service.status()).download === null);
		expect(percents.length).toBeGreaterThan(0);
		expect(percents.every((p) => p >= 0 && p < 100)).toBe(true);
		expect([...percents].sort((a, b) => a - b)).toEqual(percents);
	});

	test("a download that fails says why", async () => {
		const h = await harness({ up: false });
		h.service.pull("qwen3-embedding:0.6b");
		await until(async () => (await h.service.status()).download !== null);
		const { download } = await h.service.status();
		expect(download?.running).toBe(false);
		expect(download?.error).toContain("fetch failed");
	});
});
