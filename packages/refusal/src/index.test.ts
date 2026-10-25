import { describe, expect, test } from "bun:test";

import { FAILURE_MESSAGE, Refusal, wordsFor } from ".";

describe("a refusal", () => {
	test("carries its kind and its words, and keeps its cause for the log", () => {
		const cause = new Error("fatal: not a git repository");
		const refusal = new Refusal("invalid", "Pick the folder of a git clone.", {
			cause,
		});
		expect(refusal).toBeInstanceOf(Error);
		expect(refusal).toMatchObject({
			kind: "invalid",
			message: "Pick the folder of a git clone.",
			name: "Refusal",
			cause,
		});
	});
});

describe("the words a person sees", () => {
	test("are a refusal's own", () => {
		expect(wordsFor(new Refusal("conflict", "Stop the run first."))).toBe(
			"Stop the run first.",
		);
	});

	test("are plain for any other error, so no internals show", () => {
		expect(wordsFor(new TypeError("x is undefined"))).toBe(FAILURE_MESSAGE);
		expect(wordsFor("exit code 128")).toBe(FAILURE_MESSAGE);
	});
});
