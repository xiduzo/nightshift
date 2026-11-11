import { describe, expect, test } from "bun:test";

import { neededReasonLabel, neededReasonsText } from "./needed";

describe("why runs needed you", () => {
	test("says what you did", () => {
		expect(neededReasonLabel("gate")).toBe("Answered a Gate");
		expect(neededReasonLabel("took-over")).toBe("Took over");
	});

	test("says how many runs had each reason, in one line", () => {
		expect(
			neededReasonsText([
				{ reason: "gate", runs: 3 },
				{ reason: "resumed", runs: 1 },
			]),
		).toBe("Answered a Gate: 3 runs. Resumed: 1 run.");
		expect(neededReasonsText([])).toBe("");
	});
});
