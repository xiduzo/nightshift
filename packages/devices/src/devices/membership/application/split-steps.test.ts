import { describe, expect, test } from "bun:test";
import { splitSteps } from "./split-steps";

describe("splitSteps", () => {
	test("exports the steps factory", () => {
		expect(typeof splitSteps).toBe("function");
	});
});
