/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { DashboardSummary } from "@nightshift/client";
import { atLocal, utc } from "@nightshift/client/testing";
import {
	type LeadItem,
	leadText,
	type NightRun,
	nightLine,
	nightNumbers,
	nightOutput,
	runningNow,
	todayLine,
} from "./last-night";

type LastNight = NonNullable<DashboardSummary["lastNight"]>;
type Nights = DashboardSummary["nights"][number];

const HOUR = 3_600_000;
const NIGHT = utc(2026, 9, 22, 12);

/** Writes a time as hours after the night's noon: "+6". */
const time = (at: number) => `+${(at - NIGHT) / HOUR}`;

const cost = (costUsd: number, costMissing = 0) => ({
	costUsd,
	costEstimated: false,
	costMissing,
});

function run(id: string, over: Partial<NightRun> = {}): NightRun {
	return {
		id,
		title: id,
		status: "finished",
		createdAt: NIGHT + 6 * HOUR,
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

/** The night's runs are whole runs: the phone reads only their NightRun part. */
function lastNight(latest: NightRun[], runs = latest.length): LastNight {
	return {
		night: NIGHT,
		runs,
		cost: cost(1.5),
		tokens: 0,
		latest: latest as LastNight["latest"],
	};
}

function nights(range: Nights["nights"], perNight: Nights["runs"]["perNight"]) {
	return { nights: range, runs: { perNight } } as unknown as Nights;
}

function summary(over: Partial<DashboardSummary> = {}): DashboardSummary {
	return {
		at: NIGHT + 20 * HOUR,
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

describe("nightNumbers", () => {
	test("has nothing without runs", () => {
		expect(nightNumbers(summary())).toBeNull();
	});

	test("counts the night from its night range, and gives its cost", () => {
		const numbers = nightNumbers(
			summary({
				lastNight: lastNight([run("a")], 9),
				nights: [
					nights(7, [
						{ night: NIGHT - 24 * HOUR, counts: { finished: 5 } },
						{
							night: NIGHT,
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

	test("counts a night older than every range from its runs, when it lists them all", () => {
		const numbers = nightNumbers(
			summary({
				lastNight: lastNight([
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

	test("does not guess the counts when it lists part of an old night", () => {
		const numbers = nightNumbers(
			summary({ lastNight: lastNight([run("a")], 8) }),
		);
		expect(numbers).toMatchObject({
			finished: null,
			failed: null,
			stopped: null,
		});
	});
});

describe("runningNow", () => {
	test("joins the open runs and the night's runs at work, once each, the newest first", () => {
		const old = run("old", { status: "running", createdAt: NIGHT });
		const fresh = run("fresh", { status: "running", createdAt: NIGHT + HOUR });
		const list = runningNow(
			summary({
				open: {
					rows: [
						old,
						run("gate", { status: "waiting", createdAt: NIGHT + 2 * HOUR }),
						run("asleep", { status: "sleeping" }),
						fresh,
					],
					count: 3,
					running: 2,
					nextWakeAt: null,
				},
				lastNight: lastNight([fresh, run("done")]),
			}),
		);
		expect(list.map((r) => r.id)).toEqual(["gate", "fresh", "old"]);
	});
});

describe("nightOutput", () => {
	test("lists the night's runs that ended, in the summary's order", () => {
		const list = nightOutput(
			summary({
				lastNight: lastNight([
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
		const list = nightOutput(
			summary({
				lastNight: lastNight(["a", "b", "c", "d", "e"].map((id) => run(id))),
			}),
		);
		expect(list.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
	});
});

describe("nightLine", () => {
	const unknown = {
		finished: null,
		failed: null,
		stopped: null,
		cost: "",
		costCaption: "",
	};

	test("counts what finished, failed and stopped", () => {
		const numbers = { ...unknown, finished: 4, failed: 1, stopped: 1 };
		expect(nightLine(numbers, 6)).toBe(
			"Last night: 4 finished, 1 failed, 1 stopped.",
		);
	});

	test("gives the runs when the counts are not known", () => {
		expect(nightLine(unknown, 12)).toBe("Last night: 12 runs.");
		expect(nightLine(unknown, 1)).toBe("Last night: 1 run.");
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
			leadText([gate(NIGHT + 19 * HOUR), gate(null), { kind: "run" }], time),
		).toBe("2 Gates wait for you. Answer the first by +19.");
		expect(leadText([gate(NIGHT + 19 * HOUR)], time)).toBe(
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
