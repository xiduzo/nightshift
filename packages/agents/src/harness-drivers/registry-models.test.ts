import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CliAnswer, fakeCli as fakeCliIn } from "../testing/fixtures/cli";
import { HARNESS_ADAPTERS, harnessModels } from "./registry";

/** Every CLI here is a tiny fake script: the checks never run a real one. */

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "nightshift-models-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

const fakeCli = (name: string, answers: Record<string, CliAnswer>) =>
	fakeCliIn(dir, name, answers);

describe("harnessModels", () => {
	test("adds what `opencode models` lists to the adapter's models", async () => {
		const known = HARNESS_ADAPTERS.opencode.models[0] as string;
		const bin = await fakeCli("opencode", {
			models: {
				stdout: `${known}\nollama/qwen3-coder:30b\nopenrouter/z-ai/glm-4.6\nnot a model line\n`,
			},
		});
		const result = await harnessModels("opencode", bin);
		expect(result.problem).toBeNull();
		expect(result.listed).toBe(2);
		expect(
			result.models.slice(0, HARNESS_ADAPTERS.opencode.models.length),
		).toEqual([...HARNESS_ADAPTERS.opencode.models]);
		expect(result.models.slice(-2)).toEqual([
			"ollama/qwen3-coder:30b",
			"openrouter/z-ai/glm-4.6",
		]);
	});

	test("pi's model table becomes provider/model ids", async () => {
		// pi 0.73 prints the table to stderr.
		const bin = await fakeCli("pi", {
			"--list-models": {
				stderr:
					"provider  model               context  max-out\nollama    qwen3-coder:latest  128K     16.4K\nanthropic claude-opus-4-7     1M       128K\n",
			},
		});
		const result = await harnessModels("pi", bin);
		expect(result.problem).toBeNull();
		expect(result.models).toEqual([
			"default",
			"ollama/qwen3-coder:latest",
			"anthropic/claude-opus-4-7",
		]);
	});

	test("a listing that fails leaves the adapter's models, with the reason", async () => {
		const bin = await fakeCli("opencode", {
			models: { stderr: "no providers configured", code: 1 },
		});
		const result = await harnessModels("opencode", bin);
		expect(result.models).toEqual([...HARNESS_ADAPTERS.opencode.models]);
		expect(result.problem).toBe("no providers configured");
	});

	test("a harness without a listing runs nothing", async () => {
		const result = await harnessModels("claude-code", join(dir, "missing"));
		expect(result).toMatchObject({
			models: [...HARNESS_ADAPTERS["claude-code"].models],
			listed: 0,
			problem: null,
		});
	});
});
