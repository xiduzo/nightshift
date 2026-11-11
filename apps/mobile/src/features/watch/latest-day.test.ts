/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { DashboardSummary } from "@nightshift/client";
import { atLocal, utc } from "@nightshift/client/testing";
import {
	dayLine,
	dayNumbers,
	dayOutput,
	type LeadItem,
	leadText,
	runningNow,
	todayLine,
	type WatchRun,
} from "./latest-day";

type LatestDay = NonNullable<DashboardSummary["lastNight"]>;
type Days = DashboardSummary["nights"][number];

const HOUR = 3_600_000;
const DAY = utc(2026, 9, 22);

/** Writes a time as hours after the day's midnight: "+6". */
const time = (at: number) => `+${(at - DAY) / HOUR}`;

const cost = (costUsd: number, costMissing = 0) => ({
	costUsd,
	costEstimated: false,
	costMissing,
});

function run(id: string, over: Partial<WatchRun> = {}): WatchRun {
	return {
		id,
		title: id,
		status: "finished",
		createdAt: DAY + 6 * HOUR,
		reason: null,
		wakeAt: null,
		branch: `nightshift/${id}`,
		costUsd: 0,
		costEstimated: false,
		costMissing: 0,
		tokens: null,
		group: "website",
		...over,
	};
}

/** The day's runs are whole runs: the phone reads only their WatchRun part. */
function latestDay(latest: WatchRun[], runs = latest.length): LatestDay {
	return {
		night: DAY,
		runs,
		cost: cost(1.5),
		tokens: 0,
		latest: latest as unknown as LatestDay["latest"],
	};
}

function days(range: Days["nights"], perNight: Days["runs"]["perNight"]) {
	return { nights: range, runs: { perNight } } as unknown as Days;
}

function summary(over: Partial<DashboardSummary> = {}): DashboardSummary {
	return {
		at: DAY + 20 * HOUR,
		recent: [],
		open: { rows: [], count: 0, running: 0, nextWakeAt: null },
		activity: [],
		nights: [],
		lastNight: null,
		upNext: [],
		flowHealth: null,
		...over,
	} as DashboardSummary;
}

describe("dayNumbers", () => {
	test("has nothing without runs", () => {
		expect(dayNumbers(summary())).toBeNull();
	});

	test("counts the day from its range of days, and gives its cost", () => {
		const numbers = dayNumbers(
			summary({
				lastNight: latestDay([run("a")], 9),
				nights: [
					days(7, [
						{ night: DAY - 24 * HOUR, counts: { finished: 5 } },
						{
							night: DAY,
							counts: {
								finished: 6,
								failed: 2,
								interrupted: 1,
								stopped: 2,
								running: 1,
							},
						},
					]),
				],
			}),
		);
		expect(numbers).toEqual({
			finished: 6,
			failed: 3,
			stopped: 2,
			cost: "$1.50",
			costCaption: "Of 9 runs",
		});
	});

	test("counts a day older than every range from its runs, when it lists them all", () => {
		const numbers = dayNumbers(
			summary({
				lastNight: latestDay([
					run("a"),
					run("b", { status: "failed" }),
					run("c", { status: "stopped" }),
				]),
			}),
		);
		expect(numbers).toMatchObject({
			finished: 1,
			failed: 1,
			stopped: 1,
			costCaption: "Of 3 runs",
		});
	});

	test("does not guess the counts when it lists part of an old day", () => {
		const numbers = dayNumbers(
			summary({ lastNight: latestDay([run("a")], 8) }),
		);
		expect(numbers).toMatchObject({
			finished: null,
			failed: null,
			stopped: null,
		});
	});
});

describe("runningNow", () => {
	test("joins the open runs and the day's runs at work, once each, the newest first", () => {
		const old = run("old", { status: "running", createdAt: DAY });
		const fresh = run("fresh", { status: "running", createdAt: DAY + HOUR });
		const list = runningNow(
			summary({
				open: {
					rows: [
						old,
						run("gate", { status: "waiting", createdAt: DAY + 2 * HOUR }),
						run("asleep", { status: "sleeping" }),
						fresh,
					],
					count: 3,
					running: 2,
					nextWakeAt: null,
				},
				lastNight: latestDay([fresh, run("done")]),
			}),
		);
		expect(list.map((r) => r.id)).toEqual(["gate", "fresh", "old"]);
	});
});

describe("dayOutput", () => {
	test("lists the day's runs that ended, in the summary's order", () => {
		const list = dayOutput(
			summary({
				lastNight: latestDay([
					run("going", { status: "running" }),
					run("failed", { status: "failed" }),
					run("asleep", { status: "sleeping" }),
					run("waits", { status: "waiting" }),
					run("done"),
					run("halted", { status: "stopped" }),
				]),
			}),
		);
		expect(list.map((r) => r.id)).toEqual(["failed", "done", "halted"]);
	});

	test("lists at most four", () => {
		const list = dayOutput(
			summary({
				lastNight: latestDay(["a", "b", "c", "d", "e"].map((id) => run(id))),
			}),
		);
		expect(list.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
	});
});

describe("dayLine", () => {
	const unknown = {
		finished: null,
		failed: null,
		stopped: null,
		cost: "",
		costCaption: "",
	};

	test("names the day and counts what finished, failed and stopped", () => {
		const numbers = { ...unknown, finished: 4, failed: 1, stopped: 1 };
		expect(dayLine(numbers, 6, "Today")).toBe(
			"Today: 4 finished, 1 failed, 1 stopped.",
		);
	});

	test("gives the runs when the counts are not known", () => {
		expect(dayLine(unknown, 12, "Yesterday")).toBe("Yesterday: 12 runs.");
		expect(dayLine(unknown, 1, "Wed 21 Oct")).toBe("Wed 21 Oct: 1 run.");
	});
});

describe("leadText", () => {
	const gate = (at: number | null): LeadItem => ({
		kind: "gate",
		gate: { deadline: at === null ? null : { at } },
	});

	test("says nothing needs you", () => {
		expect(leadText([], time)).toBe(
			"Nothing needs you. Night Shift keeps watch.",
		);
	});

	test("counts the things when no Gate is open", () => {
		expect(leadText([{ kind: "run" }, { kind: "learning" }], time)).toBe(
			"2 things wait for you. No Gate is open.",
		);
		expect(leadText([{ kind: "learning" }], time)).toBe(
			"1 thing waits for you. No Gate is open.",
		);
	});

	test("counts the Gates and gives the first deadline", () => {
		expect(
			leadText([gate(DAY + 19 * HOUR), gate(null), { kind: "run" }], time),
		).toBe("2 Gates wait for you. Answer the first by +19.");
		expect(leadText([gate(DAY + 19 * HOUR)], time)).toBe(
			"1 Gate waits for you. Answer it by +19.",
		);
	});

	test("leaves the deadline out when the first Gate has none", () => {
		expect(leadText([gate(null)], time)).toBe("1 Gate waits for you.");
	});
});

describe("todayLine", () => {
	test("gives the day and the time", () => {
		const at = atLocal(2026, 9, 31, 7, 12);
		const line = todayLine(at, () => "07:12");
		expect(line).toContain("31");
		expect(line.endsWith(" · 07:12")).toBe(true);
	});
});
