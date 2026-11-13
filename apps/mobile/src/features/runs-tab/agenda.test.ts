/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
	formatTime,
	type RunSummary,
	type ScheduleSummary,
} from "@nightshift/client";
import { atLocal } from "@nightshift/client/testing";

import type { TonightEntry } from "@/features/schedules";
import { lineLabel, nowLines, runCaption, tonightLines } from "./agenda";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = atLocal(2026, 9, 31, 23, 12);
const TONIGHT_3 = atLocal(2026, 10, 1, 3, 0);

const run = (id: string, fields: Partial<RunSummary> = {}): RunSummary =>
	({
		id,
		status: "running",
		flowName: id,
		createdAt: NOW - 42 * MINUTE,
		wakeAt: null,
		...fields,
	}) as RunSummary;

const schedule = (fields: Partial<ScheduleSummary> = {}): ScheduleSummary =>
	({
		id: "s",
		flow: "lighthouse",
		cron: "0 3 * * *",
		enabled: true,
		nextAt: TONIGHT_3,
		inputs: {},
		last: null,
		deliveries: [],
		issues: [],
		...fields,
	}) as ScheduleSummary;

const entry = (fields: Partial<TonightEntry> = {}): TonightEntry => ({
	projectId: "p",
	projectName: "website",
	schedule: schedule(),
	key: "p:s",
	computer: "Host",
	offline: null,
	paused: false,
	started: null,
	...fields,
});

describe("runCaption", () => {
	test("a running run says how long it is at work", () => {
		expect(runCaption(run("a"), NOW)).toBe("Running for 42 min");
		expect(runCaption(run("a", { createdAt: NOW - 65 * MINUTE }), NOW)).toBe(
			"Running for 1 h 5 min",
		);
		expect(runCaption(run("a", { createdAt: NOW - 2 * HOUR }), NOW)).toBe(
			"Running for 2 h",
		);
		expect(runCaption(run("a", { createdAt: NOW - 10_000 }), NOW)).toBe(
			"Started just now",
		);
	});

	test("a sleeping run says until when", () => {
		expect(
			runCaption(run("a", { status: "sleeping", wakeAt: TONIGHT_3 }), NOW),
		).toBe(`Sleeping until ${formatTime(TONIGHT_3)}`);
		expect(runCaption(run("a", { status: "sleeping" }), NOW)).toBe("Sleeping");
	});
});

describe("nowLines", () => {
	test("the run that started first is on top, with its flow as title", () => {
		const lines = nowLines(
			[
				run("late", { createdAt: NOW - 5 * MINUTE }),
				run("early", { createdAt: NOW - 50 * MINUTE }),
				run("quick", { flowName: null, createdAt: NOW - 20 * MINUTE }),
			],
			NOW,
		);
		expect(lines.map((line) => line.title)).toEqual([
			"early",
			"Quick run",
			"late",
		]);
		expect(lines.every((line) => line.rail === "running")).toBe(true);
		expect(lines[0]?.at).toBe(NOW - 50 * MINUTE);
	});
});

describe("tonightLines", () => {
	test("a schedule that starts: its time, its project, and Pause", () => {
		const [line] = tonightLines([entry()], NOW);
		expect(line).toMatchObject({
			at: TONIGHT_3,
			title: "lighthouse",
			caption: "website",
			rail: "quiet",
			muted: false,
			action: "pause",
			runNow: "yes",
		});
	});

	test("a paused schedule: no time, faded, and Undo", () => {
		const [line] = tonightLines([entry({ paused: true })], NOW);
		expect(line).toMatchObject({
			at: null,
			caption: "Paused tonight",
			muted: true,
			action: "undo",
			runNow: "yes",
		});
	});

	test("a schedule whose computer is offline: a red line, and no Run now", () => {
		const [line] = tonightLines([entry({ offline: "MacBook Pro" })], NOW);
		expect(line).toMatchObject({
			caption: "MacBook Pro is offline",
			rail: "offline",
			action: "pause",
			runNow: "offline",
		});
		const [paused] = tonightLines(
			[entry({ offline: "MacBook Pro", paused: true })],
			NOW,
		);
		expect(paused?.rail).toBe("quiet");
		expect(paused?.caption).toBe("Paused tonight");
	});

	test("a schedule whose run is on its way opens that run", () => {
		const at = NOW - 10 * MINUTE;
		const [line] = tonightLines(
			[entry({ started: { runId: "r1", at }, paused: true })],
			NOW,
		);
		expect(line).toMatchObject({
			at,
			caption: `Started at ${formatTime(at)}`,
			rail: "running",
			muted: false,
			action: "open",
			runId: "r1",
			runNow: "no",
		});
	});

	test("a schedule without a time to start has no Pause", () => {
		const [line] = tonightLines(
			[entry({ schedule: schedule({ cron: undefined, nextAt: null }) })],
			NOW,
		);
		expect(line?.action).toBe(null);
	});

	test("a schedule without a flow cannot run now", () => {
		const [line] = tonightLines(
			[entry({ schedule: schedule({ flow: undefined }) })],
			NOW,
		);
		expect(line?.runNow).toBe("no");
	});
});

describe("lineLabel", () => {
	test("says the time, the title and the caption", () => {
		expect(lineLabel({ at: TONIGHT_3, title: "a", caption: "b" })).toBe(
			`${formatTime(TONIGHT_3)}, a, b`,
		);
		expect(lineLabel({ at: null, title: "a", caption: "b" })).toBe("a, b");
	});
});
