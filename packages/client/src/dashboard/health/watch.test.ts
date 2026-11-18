import { expect, test } from "bun:test";

import {
	againstBefore,
	type FlowSignal,
	signalFacts,
	signalId,
	signalScale,
	signalTitle,
} from "./watch";

const format = {
	cost: (usd: number) => `$${usd.toFixed(2)}`,
	time: (ms: number) => `${Math.round(ms / 60_000)} min`,
};

const signal = (more: Partial<FlowSignal> & Pick<FlowSignal, "kind">) =>
	({ severe: false, since: 10, runId: "r1", ...more }) as FlowSignal;

test("a signal says what is unusual", () => {
	expect(signalTitle(signal({ kind: "failing", count: 1 }))).toBe(
		"Its last run failed",
	);
	expect(signalTitle(signal({ kind: "failing", count: 3 }))).toBe(
		"Failed 3 runs in a row",
	);
	expect(signalTitle(signal({ kind: "nothing", count: 4 }))).toBe(
		"Nothing to do, 4 runs in a row",
	);
});

test("a signal with numbers gives its usual range and the value now", () => {
	const cost = signal({ kind: "cost", now: 4, usual: { low: 0.5, high: 1 } });
	expect(signalFacts(cost, format)).toEqual({
		usual: "$0.50 to $1.00",
		now: "$4.00",
	});
	expect(signalScale(cost)).toEqual({ low: 13, high: 25, now: 100 });
	const slow = signal({
		kind: "slow",
		now: 2_880_000,
		usual: { low: 600_000, high: 600_000 },
	});
	expect(signalFacts(slow, format)).toEqual({
		usual: "10 min",
		now: "48 min, still at work",
	});
	expect(signalFacts(signal({ kind: "failing" }), format)).toBeNull();
});

test("a signal that starts again is a new one", () => {
	const first = signalId("p/f", signal({ kind: "failing", since: 1 }));
	const again = signalId("p/f", signal({ kind: "failing", since: 2 }));
	expect(first).not.toBe(again);
});

test("a number compares with the days before", () => {
	expect(againstBefore(4, 9, "30 days")).toBe(
		"5 fewer than the 30 days before",
	);
	expect(againstBefore(9, 4, "7 days")).toBe("5 more than the 7 days before");
	expect(againstBefore(2, 2, "7 days")).toBe("the same as the 7 days before");
});
