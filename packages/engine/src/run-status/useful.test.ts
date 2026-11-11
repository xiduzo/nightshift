import { describe, expect, test } from "bun:test";
import { usefulAnswer } from "./index";

const answer = (score: string, value: number) => ({ score, value });

describe("usefulAnswer", () => {
	test("reads the last answer, yes or no", () => {
		expect(usefulAnswer([answer("useful", 1)])).toBe(true);
		expect(usefulAnswer([answer("useful", 0)])).toBe(false);
		expect(usefulAnswer([answer("useful", 1), answer("useful", 0)])).toBe(
			false,
		);
	});

	test("reads the older name pr_useful as the same answer", () => {
		expect(usefulAnswer([answer("pr_useful", 1)])).toBe(true);
		expect(usefulAnswer([answer("pr_useful", 1), answer("useful", 0)])).toBe(
			false,
		);
	});

	test("is null when nobody answered", () => {
		expect(usefulAnswer(undefined)).toBeNull();
		expect(usefulAnswer([])).toBeNull();
		expect(usefulAnswer([answer("pr_merged", 1)])).toBeNull();
	});
});
