/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { DashboardSummary } from "@nightshift/client";

import {
	type Clock,
	endedCount,
	type NightRun,
	needsYou,
	needsYouHint,
	nightLine,
	nightNumbers,
	nightOutput,
	runningHint,
	runningNow,
} from "./last-night";

type LastNight = NonNullable<DashboardSummary["lastNight"]>;
type Nights = DashboardSummary["nights"][number];
type Activity = DashboardSummary["activity"][number];

const HOUR = 3_600_000;
const NIGHT = Date.UTC(2026, 9, 22, 12);

/** A clock that writes hours after the night's noon: "+6". */
const clock: Clock = {
	day: () => "Wed 22 Oct",
	time: (at) => `+${(at - NIGHT) / HOUR}`,
};

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
		group: "website",
		...over,
	};
}

function lastNight(latest: NightRun[], runs = latest.length): LastNight {
	return { night: NIGHT, runs, cost: cost(1.5), latest };
}

function nights(range: Nights["nights"], perNight: Nights["runs"]["perNight"]) {
	return { nights: range, runs: { perNight } } as unknown as Nights;
}

function activity(rows: number[], count = rows.length): Activity {
	return {
		hours: 24,
		perHour: [],
		peak: 0,
		busy: 0,
		started: 0,
		groups: {
			rows: rows.map((atWork, index) => ({
				label: `p${index}`,
				runs: 1,
				started: 1,
				atWork,
				longest: atWork,
			})),
			count,
		},
	};
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

describe("nightLine", () => {
	test("gives the night and when its runs started", () => {
		const night = lastNight([
			run("b", { createdAt: NIGHT + 15 * HOUR }),
			run("a", { createdAt: NIGHT + 6 * HOUR }),
		]);
		expect(nightLine(night, clock)).toBe("Wed 22 Oct · 2 runs, +6–+15");
	});

	test("gives one start for one run", () => {
		expect(nightLine(lastNight([run("a")]), clock)).toBe(
			"Wed 22 Oct · 1 run at +6",
		);
	});

	test("gives only the newest start when the summary lists part of the night", () => {
		const night = lastNight([run("a", { createdAt: NIGHT + 9 * HOUR })], 12);
		expect(nightLine(night, clock)).toBe(
			"Wed 22 Oct · 12 runs, the newest at +9",
		);
	});
});

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
						{ night: NIGHT, counts: { finished: 6, failed: 2, running: 1 } },
					]),
				],
				activity: [activity([2 * HOUR, 20 * 60_000])],
			}),
		);
		expect(numbers).toEqual({
			finished: 6,
			failed: 2,
			cost: "$1.50",
			costCaption: "In 9 runs",
			runTime: "2 h 20 min of run time in the last 24 h",
		});
	});

	test("counts a night older than every range from its runs, when it lists them all", () => {
		const numbers = nightNumbers(
			summary({
				lastNight: lastNight([
					run("a"),
					run("b", { status: "failed" }),
					run("c"),
				]),
			}),
		);
		expect(numbers).toMatchObject({
			finished: 2,
			failed: 1,
			costCaption: "In 3 runs",
			runTime: null,
		});
	});

	test("does not guess the counts when it lists part of an old night", () => {
		const numbers = nightNumbers(
			summary({ lastNight: lastNight([run("a")], 8) }),
		);
		expect(numbers).toMatchObject({ finished: null, failed: null });
	});

	test("says the run time is more when the summary leaves groups out", () => {
		const numbers = nightNumbers(
			summary({
				lastNight: lastNight([run("a")]),
				activity: [activity([HOUR], 7)],
			}),
		);
		expect(numbers?.runTime).toBe("Over 1 h of run time in the last 24 h");
	});
});

describe("needsYou", () => {
	test("keeps the Gates you may answer, in their order, at most five", () => {
		const gates = [
			{ id: 1, canAnswer: true },
			{ id: 2, canAnswer: false },
			...[3, 4, 5, 6, 7].map((id) => ({ id, canAnswer: true })),
		];
		expect(needsYou(gates).map((gate) => gate.id)).toEqual([1, 3, 4, 5, 6]);
	});

	test("says what the section holds", () => {
		expect(needsYouHint(0)).toBe("Every Gate has an answer");
		expect(needsYouHint(3)).toBe("Oldest first · 3 open");
		expect(runningHint(0)).toBe("Nothing runs right now");
		expect(runningHint(1)).toBe("1 run at work");
		expect(runningHint(2)).toBe("2 runs at work");
	});
});

describe("runningNow", () => {
	test("joins the open runs and the night's runs, once each, the longest at work first", () => {
		const old = run("old", { status: "running", createdAt: NIGHT });
		const fresh = run("fresh", { status: "running", createdAt: NIGHT + HOUR });
		const list = runningNow(
			summary({
				open: {
					rows: [old, run("gate", { status: "waiting" }), fresh],
					count: 3,
					running: 2,
					nextWakeAt: null,
				},
				lastNight: lastNight([fresh, run("done")]),
			}),
		);
		expect(list.map((r) => r.id)).toEqual(["old", "fresh"]);
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
});

describe("endedCount", () => {
	test("counts the night's ended runs from the night ranges, also the unlisted ones", () => {
		const night = lastNight([run("going", { status: "running" })], 6);
		const s = summary({
			lastNight: night,
			nights: [
				nights(7, [
					{
						night: NIGHT,
						counts: { running: 1, finished: 3, failed: 1, stopped: 1 },
					},
				]),
			],
		});
		expect(endedCount(s)).toBe(5);
	});

	test("counts the listed runs when the summary lists the whole night", () => {
		const night = lastNight([run("done"), run("waits", { status: "waiting" })]);
		expect(endedCount(summary({ lastNight: night }))).toBe(1);
	});

	test("does not tell when the summary lists part of the night without counts", () => {
		const night = lastNight([run("waits", { status: "waiting" })], 4);
		expect(endedCount(summary({ lastNight: night }))).toBeNull();
	});
});
