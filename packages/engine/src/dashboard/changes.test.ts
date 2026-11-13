import { describe, expect, test } from "bun:test";
import { parseInstant } from "@nightshift/time";
import type { FlowRevisionItem } from "../flows";
import type { RunSummary } from "../read";
import {
	BEFORE_RUNS,
	changesOf,
	ownEndedRuns,
	summarizeChanges,
	trendOf,
} from "./changes";

/*
 * Before and after for one flow: the changes of the flow, the effect of
 * the last one, and the days against the days before. The clock is UTC
 * and stands at 15:00.
 */

const HOUR = 60 * 60 * 1000;
const NOW = parseInstant("2026-10-21T15:00:00Z");

let next = 0;

function aRun(fields: Partial<RunSummary> = {}): RunSummary {
	next += 1;
	const walker = { id: "device-1", name: "this computer", thisDevice: true };
	return {
		id: `run-${next}`,
		projectId: "p1",
		walker,
		device: walker,
		trigger: { kind: "manual" },
		startedBy: null,
		flowName: "night",
		title: `Run ${next}`,
		worktreePath: "",
		branch: `nightshift/run-${next}`,
		baseRef: "main",
		status: "finished",
		reason: null,
		result: "done",
		wakeAt: null,
		signal: null,
		inputs: {},
		stopAt: null,
		stopAfterStep: false,
		createdAt: NOW - HOUR,
		endedAt: NOW - HOUR + 10 * 60_000,
		costUsd: 1,
		costEstimated: false,
		costMissing: 0,
		costCalls: 1,
		warnings: [],
		subflows: [],
		gates: [],
		sleeps: [],
		neededYou: [],
		...fields,
	};
}

/** A run `hoursAgo` hours ago that took 10 minutes. */
const at = (hoursAgo: number, more: Partial<RunSummary> = {}) => {
	const createdAt = NOW - hoursAgo * HOUR;
	return aRun({ createdAt, endedAt: createdAt + 10 * 60_000, ...more });
};

const failed = (hoursAgo: number) =>
	at(hoursAgo, { status: "failed", result: null });

function save(
	hoursAgo: number,
	changes: Partial<NonNullable<FlowRevisionItem["changes"]>> = { changed: 1 },
	kind: FlowRevisionItem["kind"] = "save",
): FlowRevisionItem {
	return {
		id: `rev-${hoursAgo}`,
		at: NOW - hoursAgo * HOUR,
		kind,
		person: null,
		device: { id: "device-1", name: "this computer" },
		current: false,
		changes: {
			added: 0,
			removed: 0,
			changed: 0,
			moved: 0,
			edges: 0,
			other: 0,
			empty: false,
			...changes,
		},
	};
}

const summarize = (
	runs: RunSummary[],
	revisions: FlowRevisionItem[] = [],
	nights: 7 | 30 | 90 = 7,
) =>
	summarizeChanges(ownEndedRuns("night", runs), revisions, {
		nights,
		now: NOW,
		timeZone: "UTC",
		moves: [],
		read: 0,
	});

describe("the changes of a flow", () => {
	test("saves less than 30 minutes apart are one change, their changes added up", () => {
		const changes = changesOf([
			save(10, { added: 1 }),
			save(9.9, { changed: 2, edges: 1 }),
			save(5, { other: 1 }),
		]);
		expect(changes).toHaveLength(2);
		expect(changes[0]).toMatchObject({
			firstAt: NOW - 10 * HOUR,
			at: NOW - 9.9 * HOUR,
			saves: 2,
			added: 1,
			changed: 2,
			edges: 1,
		});
		expect(changes[1]).toMatchObject({ saves: 1, settings: 1 });
	});

	test("a save that only moves steps, and Night Shift's own upgrade, are no change", () => {
		expect(
			changesOf([
				save(10, { moved: 4, empty: true }),
				save(8, {}, "upgrade"),
				save(6, {}, "infer"),
			]),
		).toEqual([]);
	});
});

describe("the effect of the last change", () => {
	test("the runs after it against the 10 runs before it", () => {
		const before = Array.from({ length: 12 }, (_, i) => failed(100 - i));
		const after = [at(10), at(9), at(8)];
		const changes = summarize([...before, ...after], [save(20)]);
		expect(changes.lastChange?.before.runs).toBe(BEFORE_RUNS);
		expect(changes.lastChange?.after).toMatchObject({ runs: 3, finished: 3 });
		expect(changes.lastChange?.trends.finished).toBe("better");
		expect(changes.lastChange?.verdict).toBe("better");
		expect(changes.pending).toBeNull();
	});

	test("a change no run ran after waits, and the change before it shows", () => {
		const runs = [failed(60), failed(50), failed(40), at(30), at(20), at(15)];
		const changes = summarize(runs, [save(35), save(5)]);
		expect(changes.pending?.at).toBe(NOW - 5 * HOUR);
		expect(changes.lastChange?.change.at).toBe(NOW - 35 * HOUR);
		expect(changes.lastChange?.after.runs).toBe(3);
	});

	test("the runs after a change stop at the next change", () => {
		const runs = [failed(40), at(30), at(20), at(10)];
		const changes = summarize(runs, [save(35), save(25)]);
		expect(changes.lastChange?.change.at).toBe(NOW - 25 * HOUR);
		expect(changes.lastChange?.after.runs).toBe(2);
		expect(changes.lastChange?.before.runs).toBe(2);
	});

	test("under 3 runs on a side is too few to tell", () => {
		const changes = summarize([failed(30), at(10)], [save(20)]);
		expect(changes.lastChange?.verdict).toBe("few");
	});

	test("without a change there is nothing to compare", () => {
		const changes = summarize([at(10), at(5)]);
		expect(changes.lastChange).toBeNull();
		expect(changes.pending).toBeNull();
	});
});

describe("the days against the days before", () => {
	test("each run counts on its side of the split, test runs and other flows not", () => {
		const changes = summarize([
			at(2 * 24),
			at(3 * 24),
			at(10 * 24, { status: "failed", result: null }),
			at(20 * 24),
			at(1 * 24, { test: { pinned: [], skipped: [] } }),
			at(1 * 24, { flowName: "other" }),
		]);
		expect(changes.days.after.runs).toBe(2);
		expect(changes.days.before.runs).toBe(1);
		expect(changes.runs).toHaveLength(3);
		expect(changes.window.split).toBe(parseInstant("2026-10-15T00:00:00Z"));
		expect(changes.window.from).toBe(parseInstant("2026-10-08T00:00:00Z"));
	});

	test("unplanned step-ins and Gate waits count per run", () => {
		const gate = (hoursAgo: number) => ({
			openedAt: NOW - hoursAgo * HOUR,
			closedAt: NOW - hoursAgo * HOUR + 60 * 60_000,
			answeredBy: "person" as const,
		});
		const changes = summarize([
			at(30, {
				neededYou: [
					{ reason: "resumed", at: NOW - 30 * HOUR, planned: false },
					{ reason: "gate", at: NOW - 30 * HOUR, planned: true },
				],
				gates: [gate(30)],
			}),
			at(20),
		]);
		expect(changes.days.after.unplanned).toBe(0.5);
		expect(changes.days.after.waitMs).toBe(30 * 60_000);
		// The hour it waited is not work.
		expect(changes.days.after.workMs).toBe(10 * 60_000);
	});
});

describe("how a number moved", () => {
	test("by less than 10% it stayed the same", () => {
		expect(trendOf(1.05, 1, true)).toBe("same");
		expect(trendOf(0.5, 1, true)).toBe("better");
		expect(trendOf(0.5, 1, false)).toBe("worse");
		expect(trendOf(null, 1, true)).toBe("same");
		expect(trendOf(0, 0, true)).toBe("same");
	});
});
