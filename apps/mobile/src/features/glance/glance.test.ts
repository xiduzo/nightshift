import { describe, expect, test } from "bun:test";
import {
	type RunDetail,
	type RunProgress,
	type RunStatus,
	runProgress,
} from "@nightshift/client";

import { createFollower, type FollowedRun } from "./follow";
import { homeWidgetProps, runActivityProps } from "./glance-props";
import type { LockScreenPort } from "./lock-screen-port";

type Call =
	| ["show", string, string]
	| ["update", string, string]
	| ["end", string, string]
	| ["remove", string];

/** A lock screen that records what it was asked to show. */
function fakeLockScreen(
	options: { allow?: boolean; refuse?: boolean; gone?: boolean } = {},
) {
	const calls: Call[] = [];
	const port: LockScreenPort = {
		available: true,
		refusedText: "Turn it on in Settings.",
		allow: async () => options.allow ?? true,
		show: async (runId, progress) => {
			if (options.refuse) throw new Error("refused");
			calls.push(["show", runId, progress.position]);
			return `key-${runId}`;
		},
		update: async (key, progress) => {
			calls.push(["update", key, progress.position]);
			return !options.gone;
		},
		end: async (key, progress) => {
			calls.push(["end", key, progress.statusText]);
		},
		remove: async (key) => {
			calls.push(["remove", key]);
		},
	};
	return { port, calls };
}

function memoryStore() {
	let runs: FollowedRun[] = [];
	return {
		list: () => runs,
		add: (run: FollowedRun) => {
			runs = [...runs, run];
		},
		remove: (runId: string) => {
			runs = runs.filter((run) => run.runId !== runId);
		},
	};
}

const run = (status: RunStatus, started: string[]) =>
	({
		id: "run-1",
		flowName: "feature",
		status,
		flow: { nodes: [{ id: "plan" }, { id: "build" }, { id: "ship" }] },
		calledFlows: {},
		steps: started.map((nodeId, index) => ({
			id: nodeId,
			nodeId,
			visit: 1,
			startedAt: index,
			endedAt: index === started.length - 1 ? null : index,
			scope: null,
		})),
	}) as unknown as RunDetail;

const progressOf = (status: RunStatus, started: string[]): RunProgress =>
	runProgress(run(status, started));

describe("following a run on the lock screen", () => {
	test("shows the run and keeps it", async () => {
		const { port, calls } = fakeLockScreen();
		const store = memoryStore();
		const follower = createFollower({ port, store });
		const result = await follower.follow("host", "run-1", async () =>
			run("running", ["plan"]),
		);
		expect(result).toEqual({ kind: "following" });
		expect(calls).toEqual([["show", "run-1", "Step 1 of 3"]]);
		expect(store.list()).toEqual([
			{ runId: "run-1", host: "host", key: "key-run-1" },
		]);
	});

	test("says why when the person or the phone says no", async () => {
		const no = createFollower({
			port: fakeLockScreen({ allow: false }).port,
			store: memoryStore(),
		});
		expect(
			await no.follow("host", "run-1", async () => run("running", [])),
		).toEqual({ kind: "refused", reason: "Turn it on in Settings." });
		const store = memoryStore();
		const refused = createFollower({
			port: fakeLockScreen({ refuse: true }).port,
			store,
		});
		expect(
			(await refused.follow("host", "run-1", async () => run("running", [])))
				.kind,
		).toBe("refused");
		expect(store.list()).toEqual([]);
	});

	test("does not show a run that has ended", async () => {
		const { port, calls } = fakeLockScreen();
		const follower = createFollower({ port, store: memoryStore() });
		expect(
			await follower.follow("host", "run-1", async () =>
				run("finished", ["plan"]),
			),
		).toEqual({ kind: "ended" });
		expect(calls).toEqual([]);
	});

	test("shows each new progress once and ends with the run", async () => {
		const { port, calls } = fakeLockScreen();
		const store = memoryStore();
		const follower = createFollower({ port, store });
		await follower.follow("host", "run-1", async () =>
			run("running", ["plan"]),
		);
		await follower.sync("run-1", progressOf("running", ["plan"]));
		await follower.sync("run-1", progressOf("running", ["plan", "build"]));
		await follower.sync("run-1", progressOf("running", ["plan", "build"]));
		await follower.sync("run-1", progressOf("finished", ["plan", "build"]));
		await follower.sync("run-1", progressOf("finished", ["plan", "build"]));
		expect(calls).toEqual([
			["show", "run-1", "Step 1 of 3"],
			["update", "key-run-1", "Step 2 of 3"],
			["end", "key-run-1", "Finished"],
		]);
		expect(store.list()).toEqual([]);
	});

	test("forgets a run the person removed from the lock screen", async () => {
		const { port } = fakeLockScreen({ gone: true });
		const store = memoryStore();
		const follower = createFollower({ port, store });
		await follower.follow("host", "run-1", async () =>
			run("running", ["plan"]),
		);
		await follower.sync("run-1", progressOf("running", ["plan", "build"]));
		expect(store.list()).toEqual([]);
	});

	test("stops following on request", async () => {
		const { port, calls } = fakeLockScreen();
		const store = memoryStore();
		const follower = createFollower({ port, store });
		await follower.follow("host", "run-1", async () =>
			run("running", ["plan"]),
		);
		await follower.unfollow("run-1");
		await follower.sync("run-1", progressOf("running", ["plan", "build"]));
		expect(calls.at(-1)).toEqual(["remove", "key-run-1"]);
		expect(store.list()).toEqual([]);
	});

	test("keeps the order of work on one run", async () => {
		const { port, calls } = fakeLockScreen();
		const follower = createFollower({ port, store: memoryStore() });
		void follower.follow("host", "run-1", async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			return run("running", ["plan"]);
		});
		await follower.sync("run-1", progressOf("running", ["plan", "build"]));
		expect(calls.map((call) => call[0])).toEqual(["show", "update"]);
	});
});

describe("the props outside the app", () => {
	test("give the widget plain values with the status colors", () => {
		const props = homeWidgetProps({
			waiting: 1,
			waitingText: "1 Gate waits for you",
			noRunsText: "No runs yet",
			runs: [
				{
					id: "a",
					flow: "deploy",
					status: "failed",
					statusText: "Failed",
					tone: "failed",
				},
			],
		});
		expect(props.runs).toEqual([
			{
				id: "a",
				flow: "deploy",
				statusText: "Failed",
				light: "#c51e21",
				dark: "#fe6c66",
			},
		]);
		expect(JSON.parse(JSON.stringify(props))).toEqual(props);
	});

	test("show no count and no runs when the phone is not signed in", () => {
		expect(homeWidgetProps(null)).toEqual({
			waiting: 0,
			waitingText: "Open Night Shift to connect to your Host",
			noRunsText: "",
			runs: [],
		});
	});

	test("give the lock screen the flow, step, position and status only", () => {
		const props = runActivityProps(progressOf("running", ["plan", "build"]));
		expect(props).toEqual({
			flow: "feature",
			statusText: "Running",
			step: "build",
			position: "Step 2 of 3",
			fraction: 2 / 3,
			ended: false,
			light: "#0064b9",
			dark: "#5db2f7",
			staleText: "Open Night Shift to see the latest",
		});
	});
});
