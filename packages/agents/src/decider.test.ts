import { afterEach, describe, expect, test } from "bun:test";
import { DECIDER_ADAPTERS, tanstackDecider } from "./decider";
import type { DecisionInput } from "./types";

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
