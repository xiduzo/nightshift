import { afterEach, describe, expect, test } from "bun:test";
import {
	cannotMakeValueMessage,
	DECIDER_ADAPTERS,
	tanstackDecider,
} from "./decider";
import type { DecisionInput, ValueInput } from "./types";

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
			costUsd: null,
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
			expect(spec.models).toContain(spec.defaultModel);
		}
		expect(DECIDER_ADAPTERS.ollaya.apiKey).toBeNull();
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
		expect(cannotMakeValueMessage("typesafe")).toBe(
			"TypeSafe Jev cannot make a value. Choose Jev on OpenRouter or OpenAI Decisions.",
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
			costUsd: null,
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
