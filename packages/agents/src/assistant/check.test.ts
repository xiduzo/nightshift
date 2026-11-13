import { describe, expect, test } from "bun:test";
import { fakeHarness } from "../testing";
import { CHECK_LIMITS, CHECK_PROMPT, checkAgent } from "./check";

const ask = (harness: ReturnType<typeof fakeHarness>) =>
	checkAgent({
		harness,
		profile: { model: "m" },
		cwd: "/own",
		signal: new AbortController().signal,
	});

describe("checkAgent", () => {
	test("any answer in text counts, within the limits of the check", async () => {
		const harness = fakeHarness({
			steps: [{ type: "text", text: "Ready." }],
			delayMs: 1,
		});
		expect(await ask(harness)).toEqual({ answered: true });
		expect(harness.calls[0]).toMatchObject({
			prompt: CHECK_PROMPT,
			cwd: "/own",
			readOnly: true,
			maxTurns: CHECK_LIMITS.turns,
			maxBudgetUsd: CHECK_LIMITS.usd,
		});
	});

	test("a session that ends without text did not answer", async () => {
		const harness = fakeHarness({ steps: [], delayMs: 1 });
		expect(await ask(harness)).toEqual({
			answered: false,
			why: "The agent stopped without an answer.",
		});
	});

	test("a failure is a result with its words", async () => {
		const harness = fakeHarness({
			steps: [],
			outcome: { type: "error", kind: "network", message: "ECONNRESET" },
			delayMs: 1,
		});
		expect(await ask(harness)).toEqual({
			answered: false,
			why: "Night Shift could not reach the model. Check the internet connection, then try again.",
		});
	});

	test("an answer that came before a limit is still an answer", async () => {
		const harness = fakeHarness({
			steps: [{ type: "text", text: "ready" }],
			outcome: { type: "finished", limit: "budget" },
			delayMs: 1,
		});
		expect(await ask(harness)).toEqual({ answered: true });
	});
});
