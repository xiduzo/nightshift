import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import { createApiClient, createQueryUtils } from "../api";
import { createDashboardQueries } from "../dashboard";
import { createGateQueries, type OpenGate } from "../gates";
import type {
	NotificationItem,
	NotificationWatchClient,
} from "../notifications";
import type { RunWatchClient } from "../runs";
import { createScheduleQueries } from "../schedules";
import { createLiveCache } from "./cache";
import type { RunStreamBatch, Schedule } from "./run-buffer";
import type { ListedNotification, Notice, ShownNotifications } from "./shown";

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

/** A run of `runs.get`, as far as a notice reads it. */
const RUN = { id: "r1", title: "Fix the login", reason: "ship" };

/** A Gate that opened after the cache read the open Gates. */
const NEW_GATE = {
	runId: "r3",
	stepId: "c",
	projectName: "site",
	runTitle: "Update the docs",
	question: "Publish?",
};

/** Mostly the query keys are used. `runs.get` answers one run, `gates.list` the Gates open now. */
const orpc = createQueryUtils(
	createApiClient({
		link: {
			call: (path) => {
				const name = path.join(".");
				if (name === "runs.get") return Promise.resolve(RUN);
				if (name === "gates.list") return Promise.resolve([NEW_GATE]);
				return new Promise(() => {});
			},
		},
	}),
);
const gatesKey = createGateQueries(orpc).open().queryKey;
const runsKey = orpc.runs.list.queryKey({ input: {} });
const dashboardKey = createDashboardQueries(orpc).summary().queryKey;
const schedulesKey = createScheduleQueries(orpc).list("p1").queryKey;

const gate = (runId: string, stepId: string) =>
	({
		runId,
		stepId,
		projectName: "app",
		runTitle: "Fix the login",
		question: "Ship it?",
	}) as unknown as OpenGate;

/** A screen's notifications, in memory: what it showed, closed and dismissed. */
function fakeScreen(listed: { key: string | null; at: number }[] = []) {
	const shown: Notice[] = [];
	const closed: string[] = [];
	const dismissed: (string | null)[] = [];
	const screen: ShownNotifications = {
		show: (notice) => {
			shown.push(notice);
		},
		close: (key) => {
			closed.push(key);
		},
		list: async () =>
			listed.map(
				(item): ListedNotification => ({
					...item,
					dismiss: () => {
						dismissed.push(item.key);
					},
				}),
			),
	};
	return { screen, shown, closed, dismissed };
}

/** A Host's notifications stream the test feeds by hand. */
function fakeHost() {
	const controller = new AbortController();
	const queue: NotificationItem[][] = [];
	let wake: (() => void) | null = null;
	const inputs: unknown[] = [];
	let connections = 0;
	const client: NotificationWatchClient = {
		notifications: {
			async watch(input) {
				inputs.push(input);
				connections += 1;
				return (async function* () {
					while (!controller.signal.aborted) {
						const items = queue.shift();
						if (items) {
							yield* items;
							continue;
						}
						await new Promise<void>((resolve) => {
							wake = resolve;
						});
					}
				})();
			},
		},
	};
	return {
		client,
		signal: controller.signal,
		inputs,
		connections: () => connections,
		async send(...items: NotificationItem[]) {
			queue.push(items);
			wake?.();
			await Bun.sleep(0);
		},
		stop() {
			controller.abort();
			wake?.();
		},
	};
}

/** A live cache on a query client with the inbox, the runs, the dashboard and the schedules read. */
function setUp() {
	const queryClient = new QueryClient();
	queryClient.setQueryData(gatesKey, [gate("r1", "a"), gate("r2", "b")]);
	queryClient.setQueryData(runsKey, []);
	// Only whether they are read again counts, not what they hold.
	queryClient.setQueryData(dashboardKey as readonly unknown[], {});
	queryClient.setQueryData(schedulesKey as readonly unknown[], {});
	const timers = handSchedule();
	const live = createLiveCache({
		queryClient,
		orpc,
		schedule: timers.schedule,
		wait: async () => {},
	});
	const isStale = (key: readonly unknown[]) =>
		queryClient.getQueryState(key)?.isInvalidated ?? false;
	const stale = () => ({
		gates: isStale(gatesKey),
		runs: isStale(runsKey) && isStale(dashboardKey) && isStale(schedulesKey),
	});
	return { queryClient, live, stale, timers };
}

const hosts: ReturnType<typeof fakeHost>[] = [];
afterEach(() => {
	for (const host of hosts.splice(0)) host.stop();
});

/** Follows a fake Host with a fake screen. */
function follow(
	live: ReturnType<typeof createLiveCache>,
	screen = fakeScreen(),
	phone?: boolean,
) {
	const host = fakeHost();
	hosts.push(host);
	const followed = live.followHost({
		client: host.client,
		shown: screen.screen,
		signal: host.signal,
		...(phone === undefined ? {} : { phone }),
	});
	return { host, followed, ...screen };
}

const opened = (alert: boolean): NotificationItem => ({
	kind: "gate-opened",
	key: "r1:a",
	spaceId: "s1",
	runId: "r1",
	stepId: "a",
	title: "A Gate waits for you",
	alert,
	at: 1,
});

const ended = (kind: "run-finished" | "run-failed"): NotificationItem => ({
	kind,
	key: "r1:end:9",
	spaceId: "s1",
	runId: "r1",
	stepId: null,
	title: "A run finished",
	alert: true,
	at: 1,
});

const closedGate: NotificationItem = {
	kind: "gate-closed",
	key: "r1:a",
	runId: "r1",
	stepId: "a",
	at: 2,
};

const runChanged: NotificationItem = {
	kind: "run-changed",
	spaceId: "s1",
	runId: "r1",
	at: 3,
};

describe("the live cache follows the Host", () => {
	test("a Gate that opens or closes reads the Gates and the runs again, once per burst", async () => {
		const { live, stale, timers } = setUp();
		const { host } = follow(live);
		await host.send(opened(false), closedGate);
		expect(stale()).toEqual({ gates: false, runs: false });
		timers.due(300);
		expect(stale()).toEqual({ gates: true, runs: true });
	});

	test("a run that ends or changes reads the runs, the dashboard and the schedules again, not the Gates", async () => {
		for (const item of [
			ended("run-finished"),
			ended("run-failed"),
			runChanged,
		]) {
			const { live, stale, timers } = setUp();
			const { host } = follow(live);
			await host.send(item);
			timers.due(300);
			expect(stale()).toEqual({ gates: false, runs: true });
		}
	});

	test("an item of a kind this screen does not know reads everything again", async () => {
		const { live, stale, timers } = setUp();
		const { host } = follow(live);
		await host.send({ kind: "run-moved", runId: "r1" } as never);
		timers.due(300);
		expect(stale()).toEqual({ gates: true, runs: true });
	});

	test("the first live reads nothing; each one after reads everything", async () => {
		const { live, stale, timers } = setUp();
		const first = follow(live);
		await Bun.sleep(0);
		timers.due(300);
		expect(stale()).toEqual({ gates: false, runs: false });
		first.host.stop();
		await first.followed;
		// The phone comes back to the front: what happened meanwhile is lost.
		follow(live);
		await Bun.sleep(0);
		timers.due(300);
		expect(stale()).toEqual({ gates: true, runs: true });
	});

	test("the phone says it is the phone", async () => {
		const { live } = setUp();
		const { host } = follow(live, fakeScreen(), true);
		await Bun.sleep(0);
		expect(host.inputs).toEqual([{ phone: true }]);
	});

	test("an item that alerts shows a notice at once, with the words of its Gate", async () => {
		const { live } = setUp();
		const { host, shown } = follow(live);
		await host.send(opened(true));
		expect(shown).toHaveLength(1);
		const [notice] = shown;
		expect(notice?.title).toBe("A Gate waits for you");
		expect(notice?.data).toEqual({
			kind: "gate-opened",
			key: "r1:a",
			spaceId: "s1",
			runId: "r1",
			stepId: "a",
		});
		expect(notice?.route).toEqual({ to: "gate", runId: "r1", stepId: "a" });
	});

	test("a notice of a Gate reads the open Gates now for its words, not what the cache had", async () => {
		const { live } = setUp();
		const { host, shown } = follow(live);
		await host.send({
			...opened(true),
			key: "r3:c",
			runId: "r3",
			stepId: "c",
		} as NotificationItem);
		expect(await shown[0]?.describe()).toEqual({
			title: "site: a Gate waits for you",
			body: "Update the docs\nPublish?",
		});
	});

	test("a notice of a run's end reads the run by its id for its words", async () => {
		const { live } = setUp();
		const { host, shown } = follow(live);
		await host.send(ended("run-finished"));
		expect(shown[0]?.route).toEqual({ to: "run", runId: "r1" });
		expect(await shown[0]?.describe()).toEqual({
			title: "A run finished",
			body: "Fix the login\nEnded on ship",
		});
	});

	test("an item that does not alert shows nothing", async () => {
		const { live } = setUp();
		const { host, shown } = follow(live);
		await host.send(opened(false), runChanged);
		expect(shown).toEqual([]);
	});

	test("a Gate that closes takes its notifications away", async () => {
		const { live } = setUp();
		const { host, closed } = follow(live);
		await host.send(closedGate);
		expect(closed).toEqual(["r1:a"]);
	});

	test("each read of the open Gates takes away the notifications of Gates that no longer wait", async () => {
		const { live, queryClient } = setUp();
		const readAt = Date.now() + 120_000;
		const { dismissed } = follow(
			live,
			fakeScreen([
				{ key: "r1:a", at: 0 },
				{ key: "r2:b", at: 0 },
				{ key: "r9:z", at: 0 },
				// Shown just before the read: the read may not know it yet.
				{ key: "r8:y", at: readAt - 1_000 },
				// Not a Gate.
				{ key: "r7:end:3", at: 0 },
				{ key: null, at: 0 },
			]),
		);
		await Bun.sleep(0);
		// At start, by what the cache knows already: r1:a and r2:b wait.
		expect(dismissed).toEqual(["r9:z"]);
		dismissed.length = 0;
		queryClient.setQueryData(gatesKey, [gate("r1", "a")], {
			updatedAt: readAt,
		});
		await Bun.sleep(0);
		expect(dismissed).toEqual(["r2:b", "r9:z"]);
	});
});

describe("the one Gate refusal rule", () => {
	test("an answer that went, or a refusal of closed or not found, drops the Gate and its notifications", async () => {
		for (const result of [
			{ kind: "answered" },
			{ kind: "refused", refusal: "closed" },
			{ kind: "refused", refusal: "not-found" },
		] as const) {
			const { live, stale, queryClient, timers } = setUp();
			const { closed } = follow(live);
			live.gateAnswered({ runId: "r1", stepId: "a", choice: "ship" }, result);
			expect(queryClient.getQueryData<OpenGate[]>(gatesKey)).toEqual([
				gate("r2", "b"),
			]);
			await Bun.sleep(0);
			expect(closed).toEqual(["r1:a"]);
			timers.due(300);
			expect(stale()).toEqual({ gates: true, runs: true });
		}
	});

	test("a refusal for the role or the lock screen keeps the Gate: it still waits", async () => {
		for (const refusal of ["forbidden", "needs-app"] as const) {
			const { live, stale, queryClient, timers } = setUp();
			const { closed } = follow(live);
			live.gateAnswered(
				{ runId: "r1", stepId: "a", choice: "ship" },
				{ kind: "refused", refusal },
			);
			expect(queryClient.getQueryData<OpenGate[]>(gatesKey)).toHaveLength(2);
			await Bun.sleep(0);
			expect(closed).toEqual([]);
			timers.due(300);
			expect(stale()).toEqual({ gates: false, runs: false });
		}
	});
});

describe("the live cache follows one run", () => {
	test("in batches, and its steps read the runs and Gates once per burst", async () => {
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
			{ kind: "step", step: { id: "test" } },
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
