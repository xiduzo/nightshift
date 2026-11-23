import { describe, expect, test } from "bun:test";
import { mergeSteps } from "./merge-steps";

describe("mergeSteps", () => {
	test("exports the steps factory", () => {
		expect(typeof mergeSteps).toBe("function");
	});
});
