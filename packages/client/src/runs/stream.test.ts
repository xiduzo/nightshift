import { describe, expect, test } from "bun:test";

import {
	followRun,
	type RunStreamConnection,
	type RunWatchClient,
	retryDelay,
} from "./stream";
import type { RunStreamItem, StepSummary, TranscriptEntry } from "./types";

/** One connection of the fake: what it sends, then how it ends. */
type Connection = {
	items: RunStreamItem[];
	/** "drop": the stream throws after its items. "end": it ends. "refuse": the call fails. */
	ending: "drop" | "end" | "refuse";
};

const entry = (seq: number) =>
	({
		kind: "transcript",
		entry: { seq, stepId: "build" },
	}) as unknown as RunStreamItem;

const step = (id: string) =>
	({ kind: "step", step: { id } }) as unknown as RunStreamItem;

const status = (value: string) =>
	({ kind: "status", status: value }) as unknown as RunStreamItem;

/**
 * A fake `runs.watch` that plays one connection per call. After the last
 * one it stops the stream, as a person who leaves the page.
 */
function fakeServer(connections: Connection[]) {
	const controller = new AbortController();
	const calls: { runId: string; afterSeq?: number }[] = [];
	const client: RunWatchClient = {
		runs: {
			async watch(input) {
				calls.push(input);
				const next = connections.shift();
				if (!next) {
					controller.abort();
					throw new Error("closed");
				}
				if (next.ending === "refuse") throw new Error("offline");
				return (async function* () {
					for (const item of next.items) yield item;
					if (next.ending === "drop") throw new Error("dropped");
				})();
			},
		},
	};
	return { client, calls, signal: controller.signal, controller };
}

async function follow(connections: Connection[]) {
	const server = fakeServer(connections);
	const entries: number[] = [];
	const steps: string[] = [];
	const statuses: string[] = [];
	const states: RunStreamConnection[] = [];
	const delays: number[] = [];
	await followRun({
		client: server.client,
		runId: "run-1",
		signal: server.signal,
		onEntry: (e: TranscriptEntry) => entries.push(e.seq),
		onStep: (s: StepSummary) => steps.push(s.id),
		onStatus: (s) => statuses.push(s),
		onConnection: (state) => states.push(state),
		wait: async (ms) => {
			delays.push(ms);
		},
	});
	return { ...server, entries, steps, statuses, states, delays };
}

describe("the stream of one run", () => {
	test("hands on the status, each step and each entry", async () => {
		const run = await follow([
			{
				items: [status("running"), step("build"), entry(1), entry(2)],
				ending: "end",
			},
		]);
		expect(run.statuses).toEqual(["running"]);
		expect(run.steps).toEqual(["build"]);
		expect(run.entries).toEqual([1, 2]);
	});

	test("asks from the start, then only after the last entry it has", async () => {
		const run = await follow([
			{ items: [entry(1), entry(2), entry(3)], ending: "drop" },
			{ items: [entry(4)], ending: "drop" },
			{ items: [], ending: "refuse" },
		]);
		expect(run.calls.map((call) => call.afterSeq)).toEqual([
			undefined,
			3,
			4,
			4,
		]);
		expect(run.calls.every((call) => call.runId === "run-1")).toBe(true);
	});

	test("hands on each entry once, also when the server sends it again", async () => {
		const run = await follow([
			{ items: [entry(1), entry(2), entry(3)], ending: "drop" },
			{
				items: [entry(2), entry(3), entry(4), entry(4), entry(5)],
				ending: "end",
			},
		]);
		expect(run.entries).toEqual([1, 2, 3, 4, 5]);
	});

	test("waits longer after each failed try, up to 15 seconds", async () => {
		const refuse: Connection = { items: [], ending: "refuse" };
		const run = await follow([refuse, refuse, refuse, refuse, refuse, refuse]);
		expect(run.delays).toEqual([1000, 2000, 4000, 8000, 15_000, 15_000]);
	});

	test("starts the wait again at one second after the stream sent something", async () => {
		const run = await follow([
			{ items: [], ending: "refuse" },
			{ items: [], ending: "refuse" },
			{ items: [entry(1)], ending: "drop" },
		]);
		expect(run.delays).toEqual([1000, 2000, 1000]);
	});

	test("says when it is live and when it reconnects", async () => {
		const run = await follow([
			{ items: [entry(1)], ending: "drop" },
			{ items: [], ending: "refuse" },
			{ items: [entry(2)], ending: "end" },
		]);
		expect(run.states).toEqual([
			"connecting",
			"live",
			"reconnecting",
			"reconnecting",
			"live",
			"reconnecting",
		]);
	});

	test("stops without a retry when the caller stops it", async () => {
		const controller = new AbortController();
		let calls = 0;
		const client: RunWatchClient = {
			runs: {
				async watch() {
					calls += 1;
					return (async function* () {
						yield entry(1);
						controller.abort();
						throw new Error("aborted");
					})();
				},
			},
		};
		const delays: number[] = [];
		await followRun({
			client,
			runId: "run-1",
			signal: controller.signal,
			onEntry: () => {},
			onStep: () => {},
			onStatus: () => {},
			wait: async (ms) => {
				delays.push(ms);
			},
		});
		expect(calls).toBe(1);
		expect(delays).toEqual([]);
	});

	test("the real wait ends early when the caller stops", async () => {
		const controller = new AbortController();
		const client: RunWatchClient = {
			runs: {
				async watch() {
					throw new Error("offline");
				},
			},
		};
		const done = followRun({
			client,
			runId: "run-1",
			signal: controller.signal,
			onEntry: () => {},
			onStep: () => {},
			onStatus: () => {},
		});
		await Bun.sleep(5);
		const started = Date.now();
		controller.abort();
		await done;
		expect(Date.now() - started).toBeLessThan(500);
	});
});

describe("the wait before a retry", () => {
	test("doubles from one second and stops at 15 seconds", () => {
		expect([0, 1, 2, 3, 4, 5, 10].map(retryDelay)).toEqual([
			1000, 2000, 4000, 8000, 15_000, 15_000, 15_000,
		]);
	});
});
