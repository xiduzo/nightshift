import { afterEach, describe, expect, test } from "bun:test";
import type { DecisionInput, ValueInput } from "../port/types";
import {
	cannotMakeValueMessage,
	DECIDER_ADAPTERS,
	deciderModels,
	tanstackDecider,
} from "./decider";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

type Sent = { url: string; auth: string | null; body: Record<string, unknown> };

/** Answers TypeSafe's `/v1/systemone` with `respond`, and records each request. */
function stubTypesafe(respond: () => Response): Sent[] {
	const sent: Sent[] = [];
	globalThis.fetch = (async (url: string, init: RequestInit) => {
		sent.push({
			url,
			auth: new Headers(init.headers).get("authorization"),
			body: JSON.parse(String(init.body)),
		});
		return respond();
	}) as typeof fetch;
	return sent;
}

const answer = (choice: string, probability: number) =>
	Response.json({
		model: "jev-1.13.0",
		answers: {
			label: {
				type: "choice",
				choice,
				probabilities: { [choice]: probability },
				confidence: probability,
			},
		},
		usage: { input_tokens: 40, output_tokens: 1 },
	});

const input = (extra: Partial<DecisionInput> = {}): DecisionInput => ({
	decider: "typesafe",
	prompt: "The tests pass. Ship it?",
	labels: [
		{ name: "ship", description: "Everything is green" },
		{ name: "hold" },
	],
	signal: new AbortController().signal,
	...extra,
});

const withKey = tanstackDecider({
	secret: async (name) => (name === "TYPESAFE_API_KEY" ? "ts-key" : undefined),
});

describe("tanstackDecider", () => {
	test("asks one choice question with the labels as options", async () => {
		const sent = stubTypesafe(() => answer("ship", 0.87));
		const result = await withKey.decide(input());
		expect(result).toEqual({
			kind: "decided",
			label: "ship",
			notes: "TypeSafe Jev picked it with 87% probability.",
			probability: 0.87,
			// The stub's tokens, priced from the price list.
			costUsd: expect.any(Number),
			costSource: "estimated",
		});
		expect(sent).toHaveLength(1);
		expect(sent[0]?.url).toEndWith("/v1/systemone");
		expect(sent[0]?.auth).toBe("Bearer ts-key");
		expect(sent[0]?.body).toMatchObject({
			model: "jev-latest",
			state: "The tests pass. Ship it?",
			questions: {
				label: {
					type: "choice",
					criteria: { ship: "Everything is green", hold: null },
				},
			},
		});
	});

	test("uses the node's model when it has one", async () => {
		const sent = stubTypesafe(() => answer("hold", 0.6));
		await withKey.decide(input({ model: "jev-1.13.0" }));
		expect(sent[0]?.body.model).toBe("jev-1.13.0");
	});

	test("a missing API key names the secret, and sends nothing", async () => {
		const sent = stubTypesafe(() => answer("ship", 1));
		const result = await tanstackDecider({
			secret: async () => undefined,
		}).decide(input());
		expect(result).toMatchObject({ kind: "error", errorKind: "harness" });
		expect(result.kind === "error" && result.message).toContain(
			"TYPESAFE_API_KEY",
		);
		expect(sent).toHaveLength(0);
	});

	test("a rate limit is a usage limit, a 503 a network error", async () => {
		stubTypesafe(() => new Response("slow down", { status: 429 }));
		expect(await withKey.decide(input())).toMatchObject({
			errorKind: "usage-limit",
		});
		stubTypesafe(
			() =>
				new Response("down", {
					status: 503,
					statusText: "Service Unavailable",
				}),
		);
		expect(await withKey.decide(input())).toMatchObject({
			errorKind: "network",
		});
	});

	test("an aborted decision asks nothing", async () => {
		const sent = stubTypesafe(() => answer("ship", 1));
		const controller = new AbortController();
		controller.abort();
		expect(
			await withKey.decide(input({ signal: controller.signal })),
		).toMatchObject({ kind: "error", errorKind: "aborted" });
		expect(sent).toHaveLength(0);
	});

	test("every decider has a default model and says whether it needs a key", () => {
		for (const spec of Object.values(DECIDER_ADAPTERS)) {
			expect(spec.defaultModel).not.toBe("");
			// A server at an address lists its own models: it knows none of them.
			if (spec.models.length > 0) {
				expect(spec.models).toContain(spec.defaultModel);
			}
		}
		expect(DECIDER_ADAPTERS.ollaya.apiKey).toBeNull();
		expect(DECIDER_ADAPTERS.ollama.apiKey).toBeNull();
	});
});

/** Answers OpenRouter's `/chat/completions` with `respond`, and records each request. */
function stubOpenRouter(respond: () => Response): Sent[] {
	const sent: Sent[] = [];
	globalThis.fetch = (async (
		url: string | URL | Request,
		init?: RequestInit,
	) => {
		// The SDK sends a Request object; a plain fetch sends url and init.
		const request =
			url instanceof Request ? url : new Request(String(url), init);
		sent.push({
			url: request.url,
			auth: request.headers.get("authorization"),
			body: JSON.parse(await request.clone().text()),
		});
		return respond();
	}) as typeof fetch;
	return sent;
}

const valueInput = (extra: Partial<ValueInput> = {}): ValueInput => ({
	decider: "openrouter",
	prompt: "Which tests failed?\n\nFAIL a.test.ts\nFAIL b.test.ts",
	output: {
		type: "object",
		properties: { tests: { type: "array", items: { type: "string" } } },
		required: ["tests"],
	},
	signal: new AbortController().signal,
	...extra,
});

describe("tanstackDecider: values", () => {
	test("only the deciders with a text adapter make values", () => {
		expect(DECIDER_ADAPTERS.openrouter.value).toBeDefined();
		expect(DECIDER_ADAPTERS.openai.value).toBeDefined();
		expect(DECIDER_ADAPTERS.typesafe.value).toBeUndefined();
		expect(DECIDER_ADAPTERS.ollaya.value).toBeUndefined();
		expect(DECIDER_ADAPTERS.ollama.value).toBeDefined();
		expect(cannotMakeValueMessage("typesafe")).toBe(
			"TypeSafe Jev cannot make a value. Choose Jev on OpenRouter, OpenAI Decisions, Ollama on this computer or OpenAI-compatible server.",
		);
	});

	test("a decider that only decides answers with a plain message, and sends nothing", async () => {
		const sent = stubOpenRouter(() => Response.json({}));
		const result = await withKey.value?.(valueInput({ decider: "typesafe" }));
		expect(result).toEqual({
			kind: "error",
			errorKind: "harness",
			message: cannotMakeValueMessage("typesafe"),
			costUsd: null,
		});
		expect(sent).toHaveLength(0);
	});

	test("a missing API key names the secret, and sends nothing", async () => {
		const sent = stubOpenRouter(() => Response.json({}));
		const result = await tanstackDecider({
			secret: async () => undefined,
		}).value?.(valueInput());
		expect(result).toMatchObject({ kind: "error", errorKind: "harness" });
		expect(result?.kind === "error" && result.message).toContain(
			"OPENROUTER_API_KEY",
		);
		expect(sent).toHaveLength(0);
	});

	test("asks one chat completion held to the schema, and hands back its JSON", async () => {
		// OpenRouter holds a chat completion to the schema on the wire
		// (`response_format`), so TanStack streams the answer and parses its text.
		const chunk = (delta: Record<string, unknown>, finish: string | null) =>
			`data: ${JSON.stringify({
				id: "gen-1",
				object: "chat.completion.chunk",
				created: 1_760_000_000,
				model: "openai/gpt-mini",
				choices: [{ index: 0, delta, finish_reason: finish }],
			})}\n\n`;
		const sent = stubOpenRouter(
			() =>
				new Response(
					chunk(
						{ role: "assistant", content: '{"tests":["a.test.ts",' },
						null,
					) +
						chunk({ content: '"b.test.ts"]}' }, "stop") +
						"data: [DONE]\n\n",
					{ status: 200, headers: { "content-type": "text/event-stream" } },
				),
		);
		const openRouter = tanstackDecider({
			secret: async (name) =>
				name === "OPENROUTER_API_KEY" ? "or-key" : undefined,
		});
		const result = await openRouter.value?.(valueInput());
		expect(result).toEqual({
			kind: "made",
			data: { tests: ["a.test.ts", "b.test.ts"] },
			// The stub reports no usage.
			costUsd: null,
			costSource: null,
		});
		expect(sent).toHaveLength(1);
		expect(sent[0]?.url).toEndWith("/chat/completions");
		expect(sent[0]?.auth).toBe("Bearer or-key");
		expect(sent[0]?.body).toMatchObject({
			model: "~openai/gpt-mini-latest",
			messages: [{ role: "user", content: expect.stringContaining("FAIL") }],
			response_format: {
				type: "json_schema",
				json_schema: expect.objectContaining({
					schema: expect.objectContaining({ type: "object" }),
				}),
			},
		});
	});

	test("an aborted value asks nothing", async () => {
		const sent = stubOpenRouter(() => Response.json({}));
		const controller = new AbortController();
		controller.abort();
		expect(
			await withKey.value?.(valueInput({ signal: controller.signal })),
		).toMatchObject({ kind: "error", errorKind: "aborted" });
		expect(sent).toHaveLength(0);
	});
});

type OllamaSent = { url: string; body: Record<string, unknown> | null };

/** Answers Ollama's HTTP API with `respond`, and records each request. */
function stubOllama(respond: (url: string) => Response): OllamaSent[] {
	const sent: OllamaSent[] = [];
	globalThis.fetch = (async (
		url: string | URL | Request,
		init?: RequestInit,
	) => {
		const href = url instanceof Request ? url.url : String(url);
		sent.push({
			url: href,
			body: init?.body ? JSON.parse(String(init.body)) : null,
		});
		return respond(href);
	}) as typeof fetch;
	return sent;
}

/** One non-streamed `/api/chat` answer whose message is `content`. */
const ollamaChat = (content: string) =>
	Response.json({
		model: "llama3.2:latest",
		created_at: "2026-10-20T00:00:00Z",
		message: { role: "assistant", content },
		done: true,
		done_reason: "stop",
		prompt_eval_count: 30,
		eval_count: 5,
	});

const free = tanstackDecider({ secret: async () => undefined });

describe("tanstackDecider: Ollama", () => {
	test("asks a chat model held to the option keys, and reports no made-up probability", async () => {
		const sent = stubOllama(() => ollamaChat('{"choice":"hold"}'));
		const result = await free.decide(input({ decider: "ollama" }));
		expect(result).toEqual({
			kind: "decided",
			label: "hold",
			notes: "Ollama on this computer picked it.",
			costUsd: 0,
			costSource: "estimated",
		});
		expect(sent).toHaveLength(1);
		// Ollama's own default host.
		expect(sent[0]?.url).toBe("http://127.0.0.1:11434/api/chat");
		expect(sent[0]?.body).toMatchObject({
			model: "llama3.2:latest",
			stream: false,
			format: {
				type: "object",
				properties: { choice: { type: "string", enum: ["ship", "hold"] } },
				required: ["choice"],
			},
		});
		const messages = sent[0]?.body?.messages as { content: string }[];
		expect(messages.at(-1)?.content).toContain("ship: Everything is green");
	});

	test("asks the Ollama Night Shift names, with its headers", async () => {
		const headers: (string | null)[] = [];
		const sent = stubOllama(() => ollamaChat('{"choice":"ship"}'));
		const stubbed = globalThis.fetch;
		globalThis.fetch = (async (
			url: string | URL | Request,
			init?: RequestInit,
		) => {
			headers.push(new Headers(init?.headers).get("authorization"));
			return stubbed(url, init);
		}) as typeof fetch;
		const elsewhere = tanstackDecider({
			secret: async () => undefined,
			ollama: () => ({
				host: "http://studio.local:11500",
				headers: { Authorization: "Bearer t" },
			}),
		});
		await elsewhere.decide(input({ decider: "ollama" }));
		expect(sent[0]?.url).toBe("http://studio.local:11500/api/chat");
		expect(headers).toEqual(["Bearer t"]);

		const listed = stubOllama(() => Response.json({ models: [] }));
		await deciderModels("ollama", {
			ollama: () => ({ host: "http://studio.local:11500" }),
		});
		expect(listed[0]?.url).toBe("http://studio.local:11500/api/tags");
	});

	test("an answer outside the options fails the decision", async () => {
		stubOllama(() => ollamaChat('{"choice":"maybe"}'));
		const result = await free.decide(input({ decider: "ollama" }));
		expect(result).toMatchObject({ kind: "error", errorKind: "harness" });
		expect(result.kind === "error" && result.message).toContain(
			"not one of the options",
		);
	});

	test("a model that is not pulled says how to get it", async () => {
		stubOllama(() =>
			Response.json({ error: "model 'qwen3:8b' not found" }, { status: 404 }),
		);
		const result = await free.decide(
			input({ decider: "ollama", model: "qwen3:8b" }),
		);
		expect(result).toEqual({
			kind: "error",
			errorKind: "harness",
			message:
				"The model qwen3:8b is not on this computer. Run ollama pull qwen3:8b in a terminal, then run the step again.",
			costUsd: null,
		});
	});

	test("Ollama not running fails the step with how to fix it, not a network wait", async () => {
		stubOllama(() => {
			throw new Error(
				"Unable to connect. Is the computer able to access the url?",
			);
		});
		const message =
			"Ollama is not running on this computer. Start Ollama and run the step again.";
		expect(await free.decide(input({ decider: "ollama" }))).toMatchObject({
			errorKind: "harness",
			message,
		});
		expect(await free.value?.(valueInput({ decider: "ollama" }))).toMatchObject(
			{ errorKind: "harness", message },
		);
	});

	test("makes a value on its chat model, free", async () => {
		const sent = stubOllama(() =>
			ollamaChat('{"tests":["a.test.ts","b.test.ts"]}'),
		);
		const result = await free.value?.(
			valueInput({ decider: "ollama", model: "qwen2.5:3b" }),
		);
		expect(result).toEqual({
			kind: "made",
			data: { tests: ["a.test.ts", "b.test.ts"] },
			costUsd: 0,
			costSource: "estimated",
		});
		expect(sent[0]?.body).toMatchObject({
			model: "qwen2.5:3b",
			format: expect.objectContaining({ type: "object" }),
		});
	});

	test("lists the pulled models first, then the adapter's", async () => {
		stubOllama(() =>
			Response.json({
				models: [{ name: "qwen2.5:3b" }, { name: "my-own:latest" }],
			}),
		);
		const offered = await deciderModels("ollama");
		expect(offered.listed).toBe(2);
		expect(offered.problem).toBeNull();
		expect(offered.models.slice(0, 2)).toEqual(["qwen2.5:3b", "my-own:latest"]);
		expect(offered.models.filter((m) => m === "qwen2.5:3b")).toHaveLength(1);
		expect(offered.models).toContain(DECIDER_ADAPTERS.ollama.defaultModel);
		expect(offered.valueModels.slice(0, 2)).toEqual([
			"qwen2.5:3b",
			"my-own:latest",
		]);
	});

	test("a listing Ollama does not answer leaves the adapter's models, and says why", async () => {
		stubOllama(() => {
			throw new Error("Unable to connect.");
		});
		const offered = await deciderModels("ollama");
		expect(offered.listed).toBe(0);
		expect(offered.models).toEqual([...DECIDER_ADAPTERS.ollama.models]);
		expect(offered.problem).toBe(
			"Ollama does not answer on this computer. Start Ollama to see the models you pulled.",
		);
	});

	test("a decider without a listing offers the adapter's models only", async () => {
		const sent = stubOllama(() => Response.json({}));
		const offered = await deciderModels("typesafe");
		expect(offered).toEqual({
			models: [...DECIDER_ADAPTERS.typesafe.models],
			valueModels: [],
			listed: 0,
			problem: null,
		});
		expect(sent).toHaveLength(0);
	});
});

describe("tanstackDecider: the address of a Model Profile", () => {
	/** Records each request's URL and headers, and answers with `respond`. */
	function stubAddress(respond: (url: string) => Response) {
		const sent: { url: string; headers: Headers }[] = [];
		globalThis.fetch = (async (
			url: string | URL | Request,
			init?: RequestInit,
		) => {
			const request = url instanceof Request ? url : null;
			const href = request ? request.url : String(url);
			sent.push({
				url: href,
				headers: new Headers(init?.headers ?? request?.headers),
			});
			return respond(href);
		}) as typeof fetch;
		return sent;
	}

	const secrets: Record<string, string> = {
		OPENAI_API_KEY: "vendor-key",
		OPENJEV_KEY: "jev-key",
		PROXY_KEY: "proxy-key",
	};
	const withSecrets = tanstackDecider({
		secret: async (name) => secrets[name],
		ollama: () => ({ host: "http://127.0.0.1:11434" }),
	});

	test("Ollama at the profile's address wins over the Device's, with its key and headers", async () => {
		const sent = stubAddress(() => ollamaChat('{"choice":"ship"}'));
		await withSecrets.decide(
			input({
				decider: "ollama",
				address: {
					baseUrl: "http://gpu-box:11434/",
					apiKey: "OPENJEV_KEY",
					// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
					headers: { "X-Proxy-Key": "key ${PROXY_KEY}" },
				},
			}),
		);
		expect(sent[0]?.url).toBe("http://gpu-box:11434/api/chat");
		expect(sent[0]?.headers.get("authorization")).toBe("Bearer jev-key");
		expect(sent[0]?.headers.get("x-proxy-key")).toBe("key proxy-key");
	});

	test("OpenAI at an address asks its /v1/decisions with the address's key, not the vendor's", async () => {
		const sent = stubAddress(() =>
			Response.json({
				id: "dec_1",
				object: "decision",
				model: "openjev-latest",
				answers: [
					{
						type: "choice",
						name: "label",
						choice: "ship",
						probabilities: [
							{ value: "ship", probability: 0.9 },
							{ value: "hold", probability: 0.1 },
						],
						confidence: 0.6,
					},
				],
				usage: { input_tokens: 20, output_tokens: 0, total_tokens: 20 },
			}),
		);
		const result = await withSecrets.decide(
			input({
				decider: "openai",
				model: "openjev-latest",
				address: { baseUrl: "http://openjev:8080/v1", apiKey: "OPENJEV_KEY" },
			}),
		);
		expect(result).toMatchObject({ kind: "decided", label: "ship" });
		expect(sent[0]?.url).toBe("http://openjev:8080/v1/decisions");
		expect(sent[0]?.headers.get("authorization")).toBe("Bearer jev-key");
	});

	test("a secret the address reads that is missing names it, and sends nothing", async () => {
		const sent = stubAddress(() => ollamaChat('{"choice":"ship"}'));
		const address = {
			baseUrl: "http://gpu-box:11434",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
			headers: { "X-Proxy-Key": "${NOT_SAVED}" },
		};
		const message =
			"The address http://gpu-box:11434 needs the secret NOT_SAVED. Add it on the Secrets page.";
		expect(
			await withSecrets.decide(input({ decider: "ollama", address })),
		).toMatchObject({ kind: "error", errorKind: "harness", message });
		expect(
			await withSecrets.value?.(valueInput({ decider: "ollama", address })),
		).toMatchObject({ kind: "error", errorKind: "harness", message });
		expect(sent).toHaveLength(0);
	});
});

describe("tanstackDecider: OpenJev and an OpenAI-compatible server", () => {
	function stub(respond: (url: string) => Response) {
		const sent: { url: string; auth: string | null; body: unknown }[] = [];
		globalThis.fetch = (async (
			url: string | URL | Request,
			init?: RequestInit,
		) => {
			const request = url instanceof Request ? url : null;
			const href = request ? request.url : String(url);
			const raw = init?.body ?? (request ? await request.clone().text() : null);
			sent.push({
				url: href,
				auth: new Headers(init?.headers ?? request?.headers).get(
					"authorization",
				),
				body: raw ? JSON.parse(String(raw)) : null,
			});
			return respond(href);
		}) as typeof fetch;
		return sent;
	}
	const decider = tanstackDecider({
		secret: async (name) => (name === "OPENJEV_KEY" ? "jev-key" : undefined),
	});
	const openjev = { baseUrl: "http://openjev:8080", apiKey: "OPENJEV_KEY" };
	const lmStudio = { baseUrl: "http://127.0.0.1:1234/v1" };
	/** One streamed chat completion whose text is `content`: TanStack streams a held answer. */
	const chatAnswer = (content: string) => {
		const chunk = (delta: Record<string, unknown>, finish: string | null) =>
			`data: ${JSON.stringify({
				id: "c1",
				object: "chat.completion.chunk",
				created: 1_760_000_000,
				model: "qwen3-4b",
				choices: [{ index: 0, delta, finish_reason: finish }],
			})}\n\n`;
		return new Response(
			`${chunk({ role: "assistant", content }, null)}${chunk({}, "stop")}data: [DONE]\n\n`,
			{ status: 200, headers: { "content-type": "text/event-stream" } },
		);
	};

	test("OpenJev asks the Jev wire API at its address, free, with the probability", async () => {
		const sent = stub(() => answer("hold", 0.73));
		const result = await decider.decide(
			input({ decider: "openjev", address: openjev }),
		);
		expect(result).toEqual({
			kind: "decided",
			label: "hold",
			notes: "OpenJev picked it with 73% probability.",
			probability: 0.73,
			costUsd: 0,
			costSource: "estimated",
		});
		expect(sent[0]?.url).toBe("http://openjev:8080/v1/systemone");
		expect(sent[0]?.auth).toBe("Bearer jev-key");
		expect(sent[0]?.body).toMatchObject({ model: "openjev-latest" });
	});

	test("a decider without a vendor API needs an address, and sends nothing", async () => {
		const sent = stub(() => answer("hold", 0.5));
		expect(await decider.decide(input({ decider: "openjev" }))).toMatchObject({
			kind: "error",
			errorKind: "harness",
			message:
				"OpenJev needs an address. Pick a Model Profile with the address of its server.",
		});
		expect(sent).toHaveLength(0);
	});

	test("an OpenAI-compatible server picks on its chat model, free, without a probability", async () => {
		const sent = stub(() => chatAnswer('{"choice":"ship"}'));
		const result = await decider.decide(
			input({ decider: "compatible", model: "qwen3-4b", address: lmStudio }),
		);
		expect(result).toEqual({
			kind: "decided",
			label: "ship",
			notes: "OpenAI-compatible server picked it.",
			costUsd: 0,
			costSource: "estimated",
		});
		expect(sent[0]?.url).toBe("http://127.0.0.1:1234/v1/chat/completions");
		expect(sent[0]?.body).toMatchObject({ model: "qwen3-4b" });
	});

	test("an OpenAI-compatible server makes a value", async () => {
		stub(() => chatAnswer('{"tests":["a.test.ts"]}'));
		const result = await decider.value?.(
			valueInput({
				decider: "compatible",
				model: "qwen3-4b",
				address: lmStudio,
			}),
		);
		expect(result).toEqual({
			kind: "made",
			data: { tests: ["a.test.ts"] },
			costUsd: 0,
			costSource: "estimated",
		});
	});

	test("lists the models of the address first", async () => {
		const sent = stub(() =>
			Response.json({ data: [{ id: "openjev-latest" }, { id: "clef-1.0" }] }),
		);
		const offered = await deciderModels(
			"openjev",
			{},
			{
				root: "http://openjev:8080",
				headers: {},
				apiKey: "jev-key",
			},
		);
		expect(sent[0]).toMatchObject({
			url: "http://openjev:8080/v1/models",
			auth: "Bearer jev-key",
		});
		expect(offered).toMatchObject({ listed: 2, problem: null });
		expect(offered.models.slice(0, 3)).toEqual([
			"openjev-latest",
			"clef-1.0",
			"laya-1.0",
		]);
	});

	test("lists the models of an OpenJev address in Jev's shape", async () => {
		stub(() =>
			Response.json({
				models: [{ name: "openjev-latest" }, { name: "diffusiongemma-26b" }],
			}),
		);
		const offered = await deciderModels(
			"openjev",
			{},
			{ root: "http://127.0.0.1:18080", headers: {}, apiKey: undefined },
		);
		expect(offered).toMatchObject({ listed: 2, problem: null });
		expect(offered.models.slice(0, 2)).toEqual([
			"openjev-latest",
			"diffusiongemma-26b",
		]);
	});

	test("an address that refuses the key, or does not answer, says so", async () => {
		const at = { root: "http://openjev:8080", headers: {}, apiKey: undefined };
		stub(() => new Response("no", { status: 401 }));
		expect((await deciderModels("openjev", {}, at)).problem).toBe(
			"http://openjev:8080 refuses the API key. Check the secret of the address.",
		);
		stub(() => {
			throw new Error(
				"Unable to connect. Is the computer able to access the url?",
			);
		});
		expect((await deciderModels("compatible", {}, at)).problem).toBe(
			"Nothing answers at http://openjev:8080. Start the server, or check the address.",
		);
	});
});
