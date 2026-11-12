import { afterEach, describe, expect, test } from "bun:test";
import { now } from "@nightshift/time";
import { QueryClient } from "@tanstack/react-query";
import { createApiClient, createQueryUtils } from "../api";
import { type Change, staleAfter } from "../changes";
import { SAVES } from "../changes/changes";
import { createDashboardQueries } from "../dashboard";
import { createGateQueries, type OpenGate } from "../gates";
import { createKnowledgeQueries } from "../knowledge";
import type {
	NotificationItem,
	NotificationWatchClient,
} from "../notifications";
import { createProjectQueries } from "../projects";
import { createRunQueries, type RunWatchClient, type Wait } from "../runs";
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

/** The procedures the live cache called, by name. */
const called: string[] = [];

/** Mostly the query keys are used. `runs.get` answers one run, `gates.list` the Gates open now. */
const orpc = createQueryUtils(
	createApiClient({
		link: {
			call: (path) => {
				const name = path.join(".");
				called.push(name);
				if (name === "runs.get") return Promise.resolve(RUN);
				if (name === "gates.list") return Promise.resolve([NEW_GATE]);
				return new Promise(() => {});
			},
		},
	}),
);
const gatesKey = createGateQueries(orpc).open().queryKey;
const runs = createRunQueries(orpc);

/** Every query a screen may hold, by a short name: the test checks which ones a read reads again. */
const KEYS = {
	gates: gatesKey,
	everyRun: runs.everyRun().queryKey,
	ofProject: runs.ofProject("p1").queryKey,
	run1: runs.get("r1").queryKey,
	run2: runs.get("r2").queryKey,
	step1: runs.step("r1", "a").queryKey,
	step2: runs.step("r2", "b").queryKey,
	files1: runs.artifacts("r1", true).queryKey,
	files2: runs.artifacts("r2", true).queryKey,
	folder1: runs.files("r1", true).queryKey,
	folder2: runs.files("r2", true).queryKey,
	devices: runs.devices("p1").queryKey,
	placements: runs.placements("p1").queryKey,
	moveTargets: runs.moveTargets("r1").queryKey,
	dashboard: createDashboardQueries(orpc).summary().queryKey,
	flowHealth: createDashboardQueries(orpc).flow("p1", "fix").queryKey,
	schedules: createScheduleQueries(orpc).list("p1").queryKey,
	cron: createScheduleQueries(orpc).preview("0 3 * * *").queryKey,
	projects: createProjectQueries(orpc).list().queryKey,
	branches: createProjectQueries(orpc).branches("p1").queryKey,
	learnings: createKnowledgeQueries(orpc).learnings().queryKey,
	review: createKnowledgeQueries(orpc).review("p1").queryKey,
	knowledge: orpc.knowledge.get.queryOptions({ input: { projectId: "p1" } })
		.queryKey,
	flows: orpc.flows.list.queryOptions({ input: { projectId: "p1" } }).queryKey,
	revisions: orpc.flows.revisions.queryOptions({
		input: { projectId: "p1", name: "night" },
	}).queryKey,
	kept: orpc.flows.kept.queryOptions({
		input: { projectId: "p1", name: "night" },
	}).queryKey,
	memory: orpc.flows.memory.queryOptions({
		input: { projectId: "p1", name: "night" },
	}).queryKey,
	map: orpc.knowledge.graph.queryOptions({ input: { projectId: "p1" } })
		.queryKey,
	members: orpc.members.list.queryOptions().queryKey,
	spaceList: orpc.spaces.list.queryOptions().queryKey,
	profiles: orpc.profiles.list.queryOptions().queryKey,
	offers: orpc.offers.list.queryOptions().queryKey,
	overview: orpc.devices.list.queryOptions().queryKey,
} as const;
type Name = keyof typeof KEYS;

/** What any change of run r1 reads again: the run, its files, the lists, the numbers, the schedules, the projects' counts, the learnings that wait, the kept values and the memory. */
const RUN_1: Name[] = [
	"kept",
	"memory",
	"learnings",
	"review",
	"everyRun",
	"ofProject",
	"run1",
	"step1",
	"files1",
	"folder1",
	"dashboard",
	"flowHealth",
	"schedules",
	"projects",
];
/**
 * What a missed stretch of the stream reads again: the Gates, what every
 * run changes, and every synced document.
 */
const EVERYTHING: Name[] = [
	"gates",
	...RUN_1,
	"run2",
	"step2",
	"files2",
	"folder2",
	"knowledge",
	"branches",
	"flows",
	"revisions",
	"map",
	"members",
	"spaceList",
	"profiles",
	"offers",
	"overview",
];
const NOTHING: Name[] = [];

/** Names in the order `stale()` gives them. */
const sorted = (names: readonly Name[]) => [...names].sort();

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

/** A live cache on a query client that holds every query of `KEYS`. */
function setUp(wait: Wait = async () => {}) {
	const queryClient = new QueryClient();
	for (const key of Object.values(KEYS)) {
		// Only whether they are read again counts, not what they hold.
		queryClient.setQueryData(key as readonly unknown[], {});
	}
	queryClient.setQueryData(gatesKey, [gate("r1", "a"), gate("r2", "b")]);
	const timers = handSchedule();
	const live = createLiveCache({
		queryClient,
		orpc,
		schedule: timers.schedule,
		wait,
	});
	/** The queries read again so far, by name, sorted. */
	const stale = () =>
		(Object.keys(KEYS) as Name[])
			.filter(
				(name) =>
					queryClient.getQueryState(KEYS[name] as readonly unknown[])
						?.isInvalidated ?? false,
			)
			.sort();
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
	test("a Gate that opens or closes reads the Gates and its run again, once per burst", async () => {
		const { live, stale, timers } = setUp();
		const { host } = follow(live);
		await host.send(opened(false), closedGate);
		expect(stale()).toEqual(NOTHING);
		timers.due(300);
		expect(stale()).toEqual(sorted(["gates", ...RUN_1]));
	});

	test("a run that changes reads that run, the lists, the dashboard, the schedules and the projects again", async () => {
		const { live, stale, timers } = setUp();
		const { host } = follow(live);
		await host.send(runChanged);
		timers.due(300);
		// Not the Gates, not another run, not the Devices of a project.
		expect(stale()).toEqual(sorted(RUN_1));
	});

	test("a run that ends reads the same, and the Knowledge page's sources: it may have synced one", async () => {
		for (const item of [ended("run-finished"), ended("run-failed")]) {
			const { live, stale, timers } = setUp();
			const { host } = follow(live);
			await host.send(item);
			timers.due(300);
			expect(stale()).toEqual(sorted([...RUN_1, "knowledge"]));
		}
	});

	test("a change of a run whose Gate waits for another branch reads the Gates again too", async () => {
		const { queryClient, live, stale, timers } = setUp();
		queryClient.setQueryData(gatesKey, [
			{ ...gate("r1", "a"), branchesWork: true },
			gate("r2", "b"),
		]);
		const { host } = follow(live);
		await host.send(runChanged);
		timers.due(300);
		expect(stale()).toEqual(sorted(["gates", ...RUN_1]));
	});

	test("a pause tonight that begins or ends reads the schedules again, and nothing else", async () => {
		const { live, stale, timers } = setUp();
		const { host } = follow(live);
		await host.send({
			kind: "schedules-changed",
			spaceId: "s1",
			projectId: "p1",
			at: 4,
		});
		expect(stale()).toEqual(NOTHING);
		timers.due(300);
		expect(stale()).toEqual(["schedules"]);
	});

	test("a burst of items of two runs reads each run once, and the lists once", async () => {
		const { live, stale, timers, queryClient } = setUp();
		const { host } = follow(live);
		const reads: unknown[] = [];
		const invalidate = queryClient.invalidateQueries.bind(queryClient);
		queryClient.invalidateQueries = (filters, options) => {
			reads.push(filters?.queryKey);
			return invalidate(filters, options);
		};
		await host.send(runChanged, { ...runChanged, runId: "r2" }, runChanged);
		timers.due(300);
		expect(stale()).toEqual(
			sorted([...RUN_1, "run2", "step2", "files2", "folder2"]),
		);
		// Each run's detail, opened steps and files once, then the lists, the dashboard, the schedules, the projects.
		expect(reads).toEqual([
			runs.getKey("r1"),
			runs.getKey("r2"),
			runs.stepKey("r1"),
			runs.stepKey("r2"),
			runs.artifactsKey("r1"),
			runs.artifactsKey("r2"),
			runs.filesKey("r1"),
			runs.filesKey("r2"),
			[["runs", "list"]],
			[["dashboard"]],
			[["schedules", "list"]],
			[["projects", "list"]],
			[["knowledge", "learnings"]],
			[["knowledge", "review"]],
			[["flows", "kept"]],
			[["flows", "memory"]],
		]);
	});

	test("learnings that a person kept or deleted read the learnings and the Knowledge page again, no run", async () => {
		const { live, stale, timers } = setUp();
		const { host } = follow(live);
		await host.send({
			kind: "learnings-changed",
			spaceId: "s1",
			projectId: "p1",
			at: 4,
		});
		timers.due(300);
		expect(stale()).toEqual(sorted(["learnings", "review", "knowledge"]));
	});

	test("a Host that changes the projects reads the projects, the dashboard and the schedules", async () => {
		const { live, stale, timers } = setUp();
		const { host } = follow(live);
		await host.send({ kind: "projects-changed", spaceId: "s1", at: 4 });
		expect(stale()).toEqual(NOTHING);
		timers.due(300);
		expect(stale()).toEqual(
			sorted(["projects", "branches", "dashboard", "flowHealth", "schedules"]),
		);
	});

	test("a flow document reads the flows, the schedules and the lists of what flows use, and its history reads the revisions", async () => {
		const { live, stale, timers } = setUp();
		const { host } = follow(live);
		await host.send({
			kind: "document-changed",
			name: "flows:p1",
			spaceId: "s1",
			at: 4,
		});
		timers.due(300);
		expect(stale()).toEqual(
			sorted([
				"flows",
				"revisions",
				"kept",
				"memory",
				"schedules",
				"profiles",
				"knowledge",
			]),
		);

		const history = setUp();
		const followed = follow(history.live);
		await followed.host.send({
			kind: "document-changed",
			name: "flows-history:p1",
			spaceId: "s1",
			at: 5,
		});
		history.timers.due(300);
		expect(history.stale()).toEqual(["revisions"]);
	});

	test("a knowledge document reads the Knowledge page, and a Space document reads its projects and Members", async () => {
		const { live, stale, timers } = setUp();
		const { host } = follow(live);
		await host.send({
			kind: "document-changed",
			name: "knowledge:p1",
			spaceId: "s1",
			at: 4,
		});
		timers.due(300);
		expect(stale()).toEqual(
			sorted(["knowledge", "learnings", "review", "map"]),
		);

		const space = setUp();
		const followed = follow(space.live);
		await followed.host.send({
			kind: "document-changed",
			name: "space:s1",
			spaceId: "s1",
			at: 5,
		});
		space.timers.due(300);
		expect(space.stale()).toEqual(
			sorted([
				"projects",
				"branches",
				"dashboard",
				"flowHealth",
				"schedules",
				"members",
				"spaceList",
			]),
		);
	});

	test("this computer's document reads its configuration, and a copy reads the Devices", async () => {
		const { live, stale, timers } = setUp();
		const { host } = follow(live);
		await host.send({
			kind: "document-changed",
			name: "device:laptop",
			spaceId: null,
			at: 4,
		});
		timers.due(300);
		expect(stale()).toEqual(sorted(["profiles", "offers"]));

		const copy = setUp();
		const followed = follow(copy.live);
		await followed.host.send({
			kind: "document-changed",
			name: "device-copy:laptop",
			spaceId: null,
			at: 5,
		});
		copy.timers.due(300);
		expect(copy.stale()).toEqual(sorted(["overview", "offers"]));
	});

	test("a document this screen does not know reads everything again", async () => {
		const { live, stale, timers } = setUp();
		const { host } = follow(live);
		await host.send({
			kind: "document-changed",
			name: "notes:shop",
			spaceId: "s1",
			at: 4,
		});
		timers.due(300);
		expect(stale()).toEqual(sorted(EVERYTHING));
	});

	test("an item of a kind this screen does not know reads everything again", async () => {
		const { live, stale, timers } = setUp();
		const { host } = follow(live);
		await host.send({ kind: "run-moved", runId: "r1" } as never);
		timers.due(300);
		expect(stale()).toEqual(sorted(EVERYTHING));
	});

	test("the first live reads nothing; each one after reads everything", async () => {
		const { live, stale, timers } = setUp();
		const first = follow(live);
		await Bun.sleep(0);
		timers.due(300);
		expect(stale()).toEqual(NOTHING);
		first.host.stop();
		await first.followed;
		// The phone comes back to the front: what happened meanwhile is lost.
		follow(live);
		await Bun.sleep(0);
		timers.due(300);
		expect(stale()).toEqual(sorted(EVERYTHING));
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

	test("a step that waits for a device shows its own words and opens its run; its end takes the notice away", async () => {
		const { live, stale, timers } = setUp();
		const { host, shown, closed } = follow(live);
		await host.send({
			kind: "device-wait",
			key: "r1:wait:a",
			spaceId: "s1",
			runId: "r1",
			stepId: "a",
			title: "Triage waits for studio-mac",
			body: "The step starts when the device is back.",
			alert: true,
			at: 1,
		});
		expect(shown[0]?.route).toEqual({ to: "run", runId: "r1" });
		called.length = 0;
		expect(await shown[0]?.describe()).toEqual({
			title: "Triage waits for studio-mac",
			body: "The step starts when the device is back.",
		});
		expect(called).toEqual([]);

		await host.send({
			kind: "wait-ended",
			key: "r1:wait:a",
			runId: "r1",
			stepId: "a",
			at: 2,
		});
		expect(closed).toEqual(["r1:wait:a"]);
		timers.due(300);
		expect(stale()).toEqual(sorted(RUN_1));
	});

	test("the words of a notice are the read of its item: the burst does not read them again", async () => {
		const { live, stale, timers } = setUp();
		const { host, shown } = follow(live);
		await host.send(ended("run-finished"), opened(true));
		called.length = 0;
		await shown[0]?.describe();
		await shown[1]?.describe();
		timers.due(300);
		expect(called).toEqual(["runs.get", "gates.list"]);
		// The run's detail and the open Gates are fresh; the rest of the run is read again.
		expect(stale()).toEqual(
			sorted([...RUN_1.filter((name) => name !== "run1"), "knowledge"]),
		);
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
		const readAt = now() + 120_000;
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

describe("the open Gates while the stream is down", () => {
	/** Waits until the follow stops: the stream stays down for the whole test. */
	const untilStopped: Wait = (_ms, signal) =>
		new Promise((resolve) => {
			signal?.addEventListener("abort", () => resolve(), { once: true });
		});

	test("are read again once a minute until the stream is live", async () => {
		const { live, stale, timers } = setUp(untilStopped);
		const controller = new AbortController();
		const followed = live.followHost({
			client: {
				notifications: {
					watch: () => Promise.reject(new TypeError("Network request failed")),
				},
			},
			shown: fakeScreen().screen,
			signal: controller.signal,
		});
		await Bun.sleep(0);
		timers.due(60_000);
		timers.due(300);
		expect(stale()).toEqual(["gates"]);
		controller.abort();
		await followed;
	});

	test("are not polled while the stream is live, nor once nothing follows", async () => {
		const { live, stale, timers } = setUp();
		const { host, followed } = follow(live);
		await Bun.sleep(0);
		timers.due(60_000);
		timers.due(300);
		expect(stale()).toEqual(NOTHING);
		host.stop();
		await followed;
		timers.due(60_000);
		timers.due(300);
		expect(stale()).toEqual(NOTHING);
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
			expect(stale()).toEqual(sorted(["gates", ...RUN_1]));
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
			expect(stale()).toEqual(NOTHING);
		}
	});
});

describe("a run the person acted on", () => {
	test("reads that run again, in one burst with the items of the stream", async () => {
		const { live, stale, timers } = setUp();
		const { host } = follow(live);
		live.runActed("r1");
		await host.send(runChanged);
		expect(stale()).toEqual(NOTHING);
		timers.due(300);
		expect(stale()).toEqual(sorted(RUN_1));
	});
});

/** The keys the query client reads again, in order. */
function readsOf(queryClient: QueryClient): unknown[] {
	const reads: unknown[] = [];
	const invalidate = queryClient.invalidateQueries.bind(queryClient);
	queryClient.invalidateQueries = (filters, options) => {
		reads.push(filters?.queryKey);
		return invalidate(filters, options);
	};
	return reads;
}

/** What `staleAfter` reads, as the keys the query client reads again. */
const keysAfter = (changes: readonly Change[]) =>
	staleAfter(changes).map((path) => [path]);

/**
 * A save of the route at `path` (`flows.save`) on the query client, as
 * `useMutation` makes it from `orpc`: its key is the route's.
 */
function save(
	queryClient: QueryClient,
	path: string,
	result: () => Promise<unknown> = async () => ({}),
): Promise<unknown> {
	const utils = path
		.split(".")
		.reduce<unknown>(
			(at, key) => (at as Record<string, unknown>)[key],
			orpc,
		) as { mutationKey(): readonly unknown[] };
	return queryClient
		.getMutationCache()
		.build(queryClient, {
			mutationKey: utils.mutationKey(),
			mutationFn: result,
		})
		.execute(undefined);
}

describe("a save on this screen", () => {
	test("reads again at once what its route wrote, for every save route", async () => {
		for (const [path, changes = []] of Object.entries(SAVES)) {
			const { live, timers, queryClient } = setUp();
			const reads = readsOf(queryClient);
			follow(live);
			await save(queryClient, path);
			expect(reads, path).toEqual(keysAfter(changes));
			timers.due(300);
			expect(reads, path).toEqual(keysAfter(changes));
		}
	});

	const flowsChanged: NotificationItem = {
		kind: "document-changed",
		name: "flows:p1",
		spaceId: "s1",
		at: 4,
	};
	const historyChanged: NotificationItem = {
		...flowsChanged,
		name: "flows-history:p1",
	};

	test("and the stream telling of it read once", async () => {
		const { live, timers, queryClient } = setUp();
		const reads = readsOf(queryClient);
		const { host } = follow(live);
		await save(queryClient, "flows.save");
		await host.send(flowsChanged, historyChanged);
		timers.due(300);
		expect(reads).toEqual(keysAfter(["flows", "flows-history"]));
	});

	test("covers an item of the stream that came before it answered", async () => {
		const { live, timers, queryClient } = setUp();
		const reads = readsOf(queryClient);
		const { host } = follow(live);
		await host.send(flowsChanged);
		await save(queryClient, "flows.remove");
		timers.due(300);
		expect(reads).toEqual(keysAfter(["flows"]));
	});

	test("does not cover a second item of the stream, nor one after the burst's time", async () => {
		const { live, timers, queryClient } = setUp();
		const reads = readsOf(queryClient);
		const { host } = follow(live);
		await save(queryClient, "flows.remove");
		// The save's own item, then another person's save of the flows.
		await host.send(flowsChanged, flowsChanged);
		timers.due(300);
		expect(reads).toEqual([...keysAfter(["flows"]), ...keysAfter(["flows"])]);

		const later = setUp();
		const laterReads = readsOf(later.queryClient);
		const followed = follow(later.live);
		await save(later.queryClient, "flows.remove");
		later.timers.due(300);
		await followed.host.send(flowsChanged);
		later.timers.due(300);
		expect(laterReads).toEqual([
			...keysAfter(["flows"]),
			...keysAfter(["flows"]),
		]);
	});

	test("that fails reads nothing", async () => {
		const { live, timers, queryClient } = setUp();
		const reads = readsOf(queryClient);
		follow(live);
		await save(queryClient, "profiles.save", () =>
			Promise.reject(new Error("not saved")),
		).catch(() => undefined);
		timers.due(300);
		expect(reads).toEqual([]);
	});

	test("reads nothing while nothing follows the Host: the phone in the background", async () => {
		const { live, timers, queryClient } = setUp();
		const reads = readsOf(queryClient);
		const { host, followed } = follow(live);
		host.stop();
		await followed;
		await save(queryClient, "profiles.save");
		timers.due(300);
		expect(reads).toEqual([]);
	});

	test("of a mutation that is not a route reads nothing", async () => {
		const { live, timers, queryClient } = setUp();
		const reads = readsOf(queryClient);
		follow(live);
		await queryClient
			.getMutationCache()
			.build(queryClient, { mutationFn: async () => ({}) })
			.execute(undefined);
		await queryClient
			.getMutationCache()
			.build(queryClient, {
				mutationKey: ["ask-why"],
				mutationFn: async () => ({}),
			})
			.execute(undefined);
		timers.due(300);
		expect(reads).toEqual([]);
	});

	test("through the client, or a job that ended, says what changed itself", async () => {
		const { live, timers, queryClient } = setUp();
		const reads = readsOf(queryClient);
		const { host } = follow(live);
		live.changed("secrets", "device");
		expect(reads).toEqual(keysAfter(["secrets", "device"]));
		await host.send({
			kind: "document-changed",
			name: "device:laptop",
			spaceId: null,
			at: 4,
		});
		timers.due(300);
		expect(reads).toEqual(keysAfter(["secrets", "device"]));
	});
});

describe("the live cache follows one run", () => {
	test("in batches, and it reads nothing again: the screen lays the steps over the run", async () => {
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
		timers.due(300);
		expect(stale()).toEqual(NOTHING);
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
