/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type {
	KnownComputer,
	PlannedSchedule,
	ScheduleSummary,
} from "@nightshift/client";

import {
	offlineNotices,
	scheduleKey,
	startWhen,
	tonightEntries,
	tonightHint,
} from "./tonight";

const HOUR = 60 * 60 * 1000;
// Saturday morning on this clock.
const NOW = new Date(2026, 9, 31, 7, 12).getTime();
const TONIGHT_3 = new Date(2026, 10, 1, 3, 0).getTime();

const schedule = (
	id: string,
	fields: Partial<ScheduleSummary> = {},
): ScheduleSummary =>
	({
		id,
		flow: id,
		cron: "0 3 * * *",
		enabled: true,
		nextAt: TONIGHT_3,
		inputs: {},
		last: null,
		deliveries: [],
		issues: [],
		...fields,
	}) as ScheduleSummary;

const planned = (s: ScheduleSummary): PlannedSchedule => ({
	projectId: "p",
	projectName: "website",
	schedule: s,
});

const known: KnownComputer[] = [
	{ id: "h", name: "Host", online: true },
	{ id: "m", name: "MacBook Pro", online: false },
	{ id: "x", name: "Unsure", online: null },
];

const none = new Map<string, "pause" | "resume">();

describe("tonightEntries", () => {
	test("takes the schedule's own computer, else the Host", () => {
		const [own, host] = tonightEntries(
			[
				planned(schedule("a", { device: "MacBook Pro" })),
				planned(schedule("b")),
			],
			known,
			"Host",
			NOW,
			none,
		);
		expect(own).toMatchObject({ computer: "MacBook Pro", offline: true });
		expect(host).toMatchObject({ computer: "Host", offline: false });
	});

	test("is not offline when the Host cannot tell, or knows no computer", () => {
		const [unsure, nameless] = tonightEntries(
			[planned(schedule("a", { device: "Unsure" })), planned(schedule("b"))],
			known,
			null,
			NOW,
			none,
		);
		expect(unsure?.offline).toBe(false);
		expect(nameless).toMatchObject({ computer: null, offline: false });
	});

	test("shows a pause on its way, and a run on its way", () => {
		const [paused, started, ended] = tonightEntries(
			[
				planned(schedule("a")),
				planned(
					schedule("b", {
						last: {
							kind: "fired",
							at: NOW - HOUR,
							runId: "r1",
							runStatus: "running",
						},
					}),
				),
				planned(
					schedule("c", {
						last: {
							kind: "fired",
							at: NOW - HOUR,
							runId: "r2",
							runStatus: "finished",
						},
					}),
				),
			],
			known,
			"Host",
			NOW,
			new Map([[scheduleKey("p", "a"), "pause" as const]]),
		);
		expect(paused?.paused).toBe(true);
		expect(started?.started).toEqual({ runId: "r1", at: NOW - HOUR });
		expect(ended?.started).toBeNull();
	});
});

describe("tonightHint", () => {
	test("counts the schedules that are not paused", () => {
		const entries = tonightEntries(
			[
				planned(schedule("a")),
				planned(schedule("b", { pausedUntil: NOW + 20 * HOUR })),
			],
			known,
			"Host",
			NOW,
			none,
		);
		expect(tonightHint(entries)).toBe("1 flow runs tonight.");
		expect(tonightHint([])).toBe("Nothing runs tonight.");
		expect(tonightHint([...entries, ...entries])).toBe("2 flows run tonight.");
	});
});

describe("startWhen", () => {
	test("says tonight for a start in the night ahead", () => {
		expect(startWhen(TONIGHT_3, NOW)).toMatch(/^at .+ tonight$/);
	});

	test("gives the day for a start by day", () => {
		const afternoon = new Date(2026, 10, 1, 14, 0).getTime();
		expect(startWhen(afternoon, NOW)).toMatch(/^tomorrow at /);
	});
});

describe("offlineNotices", () => {
	test("lists each schedule that starts on a computer that is offline", () => {
		const entries = tonightEntries(
			[
				planned(schedule("lighthouse", { device: "MacBook Pro" })),
				planned(
					schedule("paused", {
						device: "MacBook Pro",
						pausedUntil: NOW + 20 * HOUR,
					}),
				),
				planned(schedule("on-host")),
			],
			known,
			"Host",
			NOW,
			none,
		);
		const notices = offlineNotices(entries, NOW);
		expect(notices.map((notice) => notice.key)).toEqual(["p:lighthouse"]);
		expect(notices[0]?.title).toBe("MacBook Pro is offline");
		expect(notices[0]?.caption).toMatch(
			/^lighthouse needs it at .+ tonight\.$/,
		);
		expect(notices[0]?.sentence).toMatch(
			/^lighthouse needs MacBook Pro at .+ tonight\.$/,
		);
	});
});
