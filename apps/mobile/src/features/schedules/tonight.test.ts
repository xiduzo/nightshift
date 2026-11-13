/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type {
	KnownComputer,
	PlannedSchedule,
	ScheduleSummary,
} from "@nightshift/client";
import { atLocal } from "@nightshift/client/testing";
import {
	offlineNotices,
	scheduleKey,
	startWhen,
	tonightEntries,
} from "./tonight";

const HOUR = 60 * 60 * 1000;
// Saturday morning on this clock.
const NOW = atLocal(2026, 9, 31, 7, 12);
const TONIGHT_3 = atLocal(2026, 10, 1, 3, 0);

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

/** The computers each flow names: lighthouse has a step on the MacBook. */
const flowDevices = (_project: string, flow: string) =>
	flow === "lighthouse" || flow === "paused"
		? ["m"]
		: flow === "unsure"
			? ["x"]
			: [];

describe("tonightEntries", () => {
	test("every schedule runs on the Host; a computer its flow names can be offline", () => {
		const [lighthouse, host] = tonightEntries(
			[planned(schedule("lighthouse")), planned(schedule("b"))],
			known,
			flowDevices,
			"Host",
			NOW,
			none,
		);
		expect(lighthouse).toMatchObject({
			computer: "Host",
			offline: "MacBook Pro",
		});
		expect(host).toMatchObject({ computer: "Host", offline: null });
	});

	test("is not offline when the Host cannot tell, or knows no computer", () => {
		const [unsure, nameless] = tonightEntries(
			[planned(schedule("unsure")), planned(schedule("b"))],
			known,
			flowDevices,
			null,
			NOW,
			none,
		);
		expect(unsure?.offline).toBeNull();
		expect(nameless).toMatchObject({ computer: null, offline: null });
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
			flowDevices,
			"Host",
			NOW,
			new Map([[scheduleKey("p", "a"), "pause" as const]]),
		);
		expect(paused?.paused).toBe(true);
		expect(started?.started).toEqual({ runId: "r1", at: NOW - HOUR });
		expect(ended?.started).toBeNull();
	});
});

describe("startWhen", () => {
	test("says tonight for a start in the night ahead", () => {
		expect(startWhen(TONIGHT_3, NOW)).toMatch(/^at .+ tonight$/);
	});

	test("gives the day for a start by day", () => {
		const afternoon = atLocal(2026, 10, 1, 14, 0);
		expect(startWhen(afternoon, NOW)).toMatch(/^tomorrow at /);
	});
});

describe("offlineNotices", () => {
	test("lists each schedule whose flow names a computer that is offline", () => {
		const entries = tonightEntries(
			[
				planned(schedule("lighthouse")),
				planned(schedule("paused", { pausedUntil: NOW + 20 * HOUR })),
				planned(schedule("on-host")),
			],
			known,
			flowDevices,
			"Host",
			NOW,
			none,
		);
		const notices = offlineNotices(entries, NOW);
		expect(notices.map((notice) => notice.key)).toEqual(["p:lighthouse"]);
		expect(notices[0]?.sentence).toMatch(
			/^lighthouse needs MacBook Pro at .+ tonight\.$/,
		);
	});
});
