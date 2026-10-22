import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import { createApiClient, createQueryUtils } from "../api";
import { createGateQueries, type OpenGate } from "../gates";
import type { NotificationItem } from "../notifications";
import type { RunWatchClient } from "../runs";
import { createLiveCache } from "./cache";
import type { RunStreamBatch, Schedule } from "./run-buffer";

/** A schedule the test runs by hand: `due(ms)` runs what waits that long. */
function handSchedule() {
	const waiting: { run: () => void; ms: number }[] = [];
	const schedule: Schedule = (run, ms) => {
		const item = { run, ms };
		waiting.push(item);
		return () => {
			const at = waiting.indexOf(item);
			if (at >= 0) waiting.splice(at, 1);
		};
	};
	const due = (ms: number) => {
		for (const item of waiting.filter((one) => one.ms === ms)) {
			waiting.splice(waiting.indexOf(item), 1);
			item.run();
		}
	};
	return { schedule, due };
}

/** One item of `runs.watch`. */
type RunStreamItem =
	Awaited<ReturnType<RunWatchClient["runs"]["watch"]>> extends AsyncIterable<
		infer Item
	>
		? Item
		: never;

/** Only the query keys are used: a link that never answers. */
const orpc = createQueryUtils(
	createApiClient({ link: { call: () => new Promise(() => {}) } }),
);
const gatesKey = createGateQueries(orpc).open().queryKey;
const runsKey = orpc.runs.list.queryKey({ input: {} });

const gate = (runId: string, stepId: string) =>
	({ runId, stepId }) as unknown as OpenGate;

/** A live cache on a query client with the inbox and the runs read. */
function setUp() {
	const queryClient = new QueryClient();
	queryClient.setQueryData(gatesKey, [gate("r1", "a"), gate("r2", "b")]);
	queryClient.setQueryData(runsKey, []);
	const timers = handSchedule();
	const live = createLiveCache({
		queryClient,
		orpc,
		schedule: timers.schedule,
	});
	const stale = () => ({
		gates: queryClient.getQueryState(gatesKey)?.isInvalidated ?? false,
		runs: queryClient.getQueryState(runsKey)?.isInvalidated ?? false,
	});
	return { queryClient, live, stale, timers };
}

const item = (kind: NotificationItem["kind"]) =>
	({ kind, key: "r1:a", runId: "r1", stepId: "a" }) as NotificationItem;

describe("the live cache", () => {
	test("a Gate that opens or closes reads the Gates and the runs again", () => {
		for (const kind of ["gate-opened", "gate-closed"] as const) {
			const { live, stale } = setUp();
			live.onNotification(item(kind));
			expect(stale()).toEqual({ gates: true, runs: true });
		}
	});

	test("a run that ends reads only the runs again", () => {
		for (const kind of ["run-finished", "run-failed"] as const) {
			const { live, stale } = setUp();
			live.onNotification(item(kind));
			expect(stale()).toEqual({ gates: false, runs: true });
		}
	});

	test("the first live reads nothing; each one after reads everything", () => {
		const { live, stale, queryClient } = setUp();
		live.onNotificationsConnection("connecting");
		live.onNotificationsConnection("live");
		expect(stale()).toEqual({ gates: false, runs: false });
		live.onNotificationsConnection("reconnecting");
		expect(stale()).toEqual({ gates: false, runs: false });
		live.onNotificationsConnection("live");
		expect(stale()).toEqual({ gates: true, runs: true });
		// A screen that follows again later keeps what the cache knows.
		queryClient.setQueryData(gatesKey, []);
		queryClient.setQueryData(runsKey, []);
		live.onNotificationsConnection("live");
		expect(stale()).toEqual({ gates: true, runs: true });
	});

	test("an answered Gate leaves the inbox at once, and both are read again", () => {
		const { live, stale, queryClient } = setUp();
		live.afterGateAnswered({ runId: "r1", stepId: "a" });
		expect(queryClient.getQueryData<OpenGate[]>(gatesKey)).toEqual([
			gate("r2", "b"),
		]);
		expect(stale()).toEqual({ gates: true, runs: true });
	});

	test("follows a run in batches, and its steps read the runs and Gates once", async () => {
		const { live, stale, timers } = setUp();
		const controller = new AbortController();
		const batches: RunStreamBatch[] = [];
		let send: (items: RunStreamItem[]) => void = () => {};
		const client: RunWatchClient = {
			runs: {
				watch: async (input) => {
					expect(input).toEqual({ runId: "r1", afterSeq: 4 });
					return (async function* () {
						const items = await new Promise<RunStreamItem[]>((resolve) => {
							send = resolve;
						});
						yield* items;
						await new Promise((resolve) =>
							controller.signal.addEventListener("abort", resolve),
						);
					})();
				},
			},
		};
		const followed = live.followRun({
			client,
			runId: "r1",
			afterSeq: 4,
			signal: controller.signal,
			flushMs: 100,
			flushOnStop: true,
			onBatch: (batch) => batches.push(batch),
		});
		await Bun.sleep(0);
		send([
			{ kind: "transcript", entry: { seq: 5 } },
			{ kind: "step", step: { id: "build" } },
			{ kind: "status", status: "running" },
			{ kind: "transcript", entry: { seq: 6 } },
		] as unknown as RunStreamItem[]);
		await Bun.sleep(0);
		timers.due(100);
		expect(batches).toHaveLength(1);
		expect(batches[0]?.lastSeq).toBe(6);
		expect(batches[0]?.status).toBe("running");
		expect(stale()).toEqual({ gates: false, runs: false });
		timers.due(300);
		expect(stale()).toEqual({ gates: true, runs: true });
		controller.abort();
		await followed;
	});

	test("a run's stream that stops hands on what gathered, when asked", async () => {
		const { live } = setUp();
		const controller = new AbortController();
		const batches: RunStreamBatch[] = [];
		const client: RunWatchClient = {
			runs: {
				watch: async () =>
					(async function* () {
						yield { kind: "transcript", entry: { seq: 1 } } as RunStreamItem;
						controller.abort();
					})(),
			},
		};
		await live.followRun({
			client,
			runId: "r1",
			signal: controller.signal,
			flushOnStop: true,
			onBatch: (batch) => batches.push(batch),
		});
		expect(batches.map((batch) => batch.lastSeq)).toEqual([1]);
	});
});
