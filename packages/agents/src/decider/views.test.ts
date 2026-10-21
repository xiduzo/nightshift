import { afterEach, describe, expect, test } from "bun:test";
import { deciderNameSchema } from "@nightshift/flows";

import { DECIDER_ADAPTERS } from "./decider";
import { deciderViews } from "./views";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("deciderViews", () => {
	test("lists every decider, with where its API key comes from", async () => {
		// Ollama lists its models over HTTP: it does not run here.
		globalThis.fetch = (async () => {
			throw new Error("Unable to connect.");
		}) as unknown as typeof fetch;
		const asked: string[] = [];
		const views = await deciderViews((name) => {
			asked.push(name);
			return "keychain" as const;
		});
		expect(views.map((v) => v.name)).toEqual(deciderNameSchema.options);
		for (const view of views) {
			const adapter = DECIDER_ADAPTERS[view.name];
			expect(view.label).toBe(adapter.label);
			expect(view.apiKey).toBe(adapter.apiKey);
			expect(view.apiKeySource).toBe(adapter.apiKey ? "keychain" : null);
			expect(view.value === null).toBe(adapter.value === undefined);
		}
		expect(asked).toEqual(
			views.flatMap((v) => (v.apiKey === null ? [] : [v.apiKey])),
		);
		const ollama = views.find((v) => v.name === "ollama");
		expect(ollama?.listed).toBe(0);
		expect(ollama?.listProblem).not.toBeNull();
	});
});
