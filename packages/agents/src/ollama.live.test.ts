/**
 * Against the real Ollama on this computer: one decision and one value on a
 * small model. Runs only when `OLLAMA_LIVE_MODEL` names a pulled model and
 * Ollama answers, so the default test run never loads a model:
 *
 *   OLLAMA_LIVE_MODEL=qwen2.5:3b bun test src/ollama.live.test.ts
 */

import { describe, expect, test } from "bun:test";
import { deciderModels, tanstackDecider } from "./decider";

const model = process.env.OLLAMA_LIVE_MODEL;
const offered = model ? await deciderModels("ollama") : null;
const pulled = offered ? offered.models.slice(0, offered.listed) : [];
const live = model !== undefined && pulled.includes(model);

describe.skipIf(!live)(`Ollama on this computer (${model})`, () => {
	const decider = tanstackDecider({ secret: async () => undefined });
	const signal = new AbortController().signal;

	test("decides a choice", async () => {
		const result = await decider.decide({
			decider: "ollama",
			model,
			prompt:
				"3 of 214 tests fail and the build is red. Should we ship the release?",
			labels: [
				{ name: "ship", description: "Everything is green, release it" },
				{ name: "hold", description: "Something failed, wait" },
			],
			signal,
		});
		expect(result).toMatchObject({ kind: "decided", label: "hold" });
	}, 120_000);

	test("makes a value that matches a tiny schema", async () => {
		const result = await decider.value?.({
			decider: "ollama",
			model,
			prompt:
				"Which tests failed?\n\nPASS c.test.ts\nFAIL a.test.ts\nFAIL b.test.ts",
			output: {
				type: "object",
				properties: { tests: { type: "array", items: { type: "string" } } },
				required: ["tests"],
			},
			signal,
		});
		expect(result?.kind).toBe("made");
		// The shape is Ollama's to hold; what a small model puts in it varies.
		const data = result?.kind === "made" ? result.data : null;
		console.log(`${model} made`, JSON.stringify(data));
		expect(data).toEqual({ tests: expect.any(Array) });
		const tests = (data as { tests: unknown[] }).tests;
		expect(tests.length).toBeGreaterThan(0);
		for (const t of tests) expect(typeof t).toBe("string");
	}, 120_000);
});
