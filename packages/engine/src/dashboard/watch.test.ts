import { describe, expect, test } from "bun:test";

import type { NeededYou } from "../read";
import { DAY_MS } from "./clock";
import { flowWatch, type WatchRun } from "./watch";

/*
 * The watch over a flow: its level, how often it needed a person, and the
 * ways it left its usual range. Each test builds the runs of one flow.
 */

const NOW = 100 * DAY_MS;
const FIRST = NOW - 30 * DAY_MS;

const gate = (at: number, planned: boolean): NeededYou => ({
	reason: "gate",
	at,
	planned,
	nodeId: "approve",
	question: "Send it?",
});

/** A run that started `daysAgo` days ago, finished and done unless told. */
function run(daysAgo: number, more: Partial<WatchRun> = {}): WatchRun {
	const createdAt = NOW - daysAgo * DAY_MS;
	return {
		id: `run-${daysAgo}`,
		createdAt,
		endedAt: createdAt + 60_000,
		status: "finished",
		result: "done",
		costUsd: 1,
		costKnown: true,
		workMs: 60_000,
		acts: [],
		...more,
	};
}

const days = (
	count: number,
	more: (day: number) => Partial<WatchRun> = () => ({}),
) =>
	Array.from({ length: count }, (_, index) => run(index + 1, more(index + 1)));

describe("the level of a flow", () => {
	test("too few ended runs give no level", () => {
		expect(flowWatch(days(2), NOW, FIRST).level).toBeNull();
	});

	test("no person on its last runs: On its own", () => {
		expect(flowWatch(days(6), NOW, FIRST).level?.level).toBe("own");
	});

	test("a person on more than half of its last runs: You decide", () => {
		const runs = days(6, (day) => ({
			acts: day <= 4 ? [gate(NOW - day * DAY_MS, true)] : [],
		}));
		expect(flowWatch(runs, NOW, FIRST).level?.level).toBe("decide");
	});

	test("a person on some of its last runs: You check", () => {
		const runs = days(6, (day) => ({
			acts: day === 2 ? [gate(NOW - day * DAY_MS, false)] : [],
		}));
		expect(flowWatch(runs, NOW, FIRST).level?.level).toBe("check");
	});

	test("the level counts from the first run that gave it", () => {
		// Days 1 to 12 ran alone. Before that a person answered every run.
		const runs = days(20, (day) => ({
			acts: day > 12 ? [gate(NOW - day * DAY_MS, true)] : [],
		}));
		const level = flowWatch(runs, NOW, FIRST).level;
		expect(level?.level).toBe("own");
		// The window of ten runs is free of a person from day 3 back to day 12.
		expect(level?.since).toBe(NOW - 3 * DAY_MS);
	});
});

describe("how often a flow needed a person", () => {
	test("it counts each step-in, planned or not, against the days before", () => {
		const runs = [
			run(2, {
				acts: [gate(NOW - 2 * DAY_MS, true), gate(NOW - 2 * DAY_MS, false)],
			}),
			run(3, {
				acts: [{ reason: "resumed", at: NOW - 3 * DAY_MS, planned: false }],
			}),
			run(40, { acts: [gate(NOW - 40 * DAY_MS, false)] }),
		];
		const { attention } = flowWatch(runs, NOW, FIRST);
		expect(attention.planned).toBe(1);
		expect(attention.unplanned).toBe(2);
		expect(attention.before).toEqual({ planned: 0, unplanned: 1 });
		expect(attention.causes).toEqual([
			{
				reason: "gate",
				planned: false,
				times: 1,
				nodeId: "approve",
				question: "Send it?",
			},
			{ reason: "resumed", planned: false, times: 1 },
			{
				reason: "gate",
				planned: true,
				times: 1,
				nodeId: "approve",
				question: "Send it?",
			},
		]);
		expect(attention.perWeek.at(-1)).toBe(2);
		expect(attention.perWeek.at(-6)).toBe(1);
	});

	test("a Gate of an older Host counts as planned", () => {
		const runs = [run(1, { acts: [{ reason: "gate", at: NOW - DAY_MS }] })];
		const { attention } = flowWatch(runs, NOW, FIRST);
		expect(attention).toMatchObject({ planned: 1, unplanned: 0 });
	});
});

describe("the signals of a flow", () => {
	const kinds = (runs: WatchRun[]) =>
		flowWatch(runs, NOW, FIRST).signals.map((signal) => signal.kind);

	test("a flow in its usual range has none", () => {
		expect(kinds(days(10))).toEqual([]);
	});

	test("one failed run is a signal, two in a row are severe", () => {
		const one = days(6, (day) =>
			day === 1 ? { status: "failed", result: "failed" } : {},
		);
		expect(flowWatch(one, NOW, FIRST).signals).toMatchObject([
			{ kind: "failing", severe: false, count: 1, runId: "run-1" },
		]);
		const two = days(6, (day) =>
			day <= 2 ? { status: "failed", result: "failed" } : {},
		);
		expect(flowWatch(two, NOW, FIRST).signals).toMatchObject([
			{ kind: "failing", severe: true, count: 2, since: NOW - 2 * DAY_MS },
		]);
	});

	test("a later run that finished ends the failing signal", () => {
		const runs = days(6, (day) =>
			day === 2 ? { status: "failed", result: "failed" } : {},
		);
		expect(kinds(runs)).toEqual([]);
	});

	test("nothing to do, runs in a row, when it mostly did something before", () => {
		const runs = days(12, (day) =>
			day <= 3 ? { result: "nothing-to-do" } : {},
		);
		expect(flowWatch(runs, NOW, FIRST).signals).toMatchObject([
			{ kind: "nothing", count: 3 },
		]);
	});

	test("a flow that mostly finds nothing to do gives no such signal", () => {
		const runs = days(12, (day) =>
			day % 4 === 0 ? {} : { result: "nothing-to-do" },
		);
		expect(kinds(runs)).toEqual([]);
	});

	test("a last run that cost far more than every run before", () => {
		const runs = days(8, (day) => (day === 1 ? { costUsd: 5 } : {}));
		expect(flowWatch(runs, NOW, FIRST).signals).toMatchObject([
			{ kind: "cost", now: 5, usual: { low: 1, high: 1 } },
		]);
	});

	test("a dear run is no signal with too few runs before it", () => {
		const runs = days(4, (day) => (day === 1 ? { costUsd: 5 } : {}));
		expect(kinds(runs)).toEqual([]);
	});

	test("a run at work far longer than every finished run", () => {
		const runs = [
			run(0, {
				status: "running",
				endedAt: null,
				result: null,
				workMs: 600_000,
			}),
			...days(8),
		];
		expect(flowWatch(runs, NOW, FIRST).signals).toMatchObject([
			{ kind: "slow", runId: "run-0", now: 600_000 },
		]);
	});

	test("a last finished run that worked far longer than the runs before", () => {
		const runs = days(8, (day) => (day === 1 ? { workMs: 600_000 } : {}));
		expect(kinds(runs)).toEqual(["length"]);
	});
});
