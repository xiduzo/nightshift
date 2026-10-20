import { describe, expect, test } from "bun:test";

import {
	costNote,
	formatKnownCost,
	formatStepCost,
	sumKnownCost,
} from "./format";

describe("a cost that may be partly unknown", () => {
	test("known, partly known, not known", () => {
		expect(formatKnownCost({ costUsd: 2.93 })).toBe("$2.93");
		expect(formatKnownCost({ costUsd: 2.93, costMissing: 1 })).toBe("$2.93+");
		expect(formatKnownCost({ costUsd: 0, costMissing: 2 })).toBe("—");
		// A known zero is free, not unknown.
		expect(formatKnownCost({ costUsd: 0, costMissing: 0 })).toBe("$0.00");
	});

	test("the note says what is estimated or missing", () => {
		expect(costNote({ costUsd: 1 })).toBeUndefined();
		expect(costNote({ costUsd: 1, costMissing: 2, costEstimated: true })).toBe(
			"2 steps did not report their cost. Part of it is estimated from tokens.",
		);
	});

	test("sums keep what is not known", () => {
		expect(
			sumKnownCost([
				{ costUsd: 1, costMissing: 0 },
				{ costUsd: 0.5, costMissing: 1, costEstimated: true },
			]),
		).toEqual({ costUsd: 1.5, costMissing: 1, costEstimated: true });
	});

	test("a running step shows its spend so far, or a dash before it has any", () => {
		const running = { costUsd: 0, endedAt: null, costCalls: 0 };
		expect(formatStepCost(running)).toBe("—");
		expect(formatStepCost({ ...running, costUsd: 0.12, costCalls: 1 })).toBe(
			"$0.12",
		);
		// An ended step that never asked a model cost nothing.
		expect(formatStepCost({ ...running, endedAt: 1 })).toBe("$0.00");
	});
});
