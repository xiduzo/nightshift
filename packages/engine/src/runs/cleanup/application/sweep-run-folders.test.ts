import { describe, expect, test } from "bun:test";
import { cleanupPorts } from "../test-support";
import { sweepRunFolders } from "./sweep-run-folders";

/** The sweep of run folders, over a database in memory. The clock is at day 10, `cleanUpAfterDays` is 7. */

const DAY_MS = 24 * 60 * 60_000;

async function setup() {
	const ports = await cleanupPorts();
	return { ports, sweep: sweepRunFolders(ports) };
}

describe("sweepRunFolders", () => {
	test("removes the folder of a run that ended cleanUpAfterDays ago, and logs it", async () => {
		const { ports, sweep } = await setup();
		ports.runs.add({ id: "run-old", endedAt: DAY_MS, runFolder: true });
		ports.runs.add({ id: "run-new", endedAt: 5 * DAY_MS, runFolder: true });
		ports.folders.add("run-old");
		ports.folders.add("run-new");
		expect(await sweep()).toEqual({ removed: ["run-old"], kept: 0 });
		expect(ports.folders.removed).toEqual(["run-old"]);
		expect(await ports.removed()).toEqual([
			{
				projectId: "project-1",
				runId: "run-old",
				worktreePath: "/data/run-folders/run-old",
				branches: [],
			},
		]);
	});

	test("never removes the folder of an open run, nor of a run at work here", async () => {
		const { ports, sweep } = await setup();
		ports.runs.add({ id: "run-open", status: "sleeping", endedAt: null });
		ports.runs.add({ id: "run-busy", endedAt: DAY_MS });
		ports.runs.active.add("run-busy");
		ports.folders.add("run-open");
		ports.folders.add("run-busy");
		expect(await sweep()).toEqual({ removed: [], kept: 0 });
	});

	test("removes the folder of a run it does not know by its last change, and logs nothing", async () => {
		const { ports, sweep } = await setup();
		ports.folders.add("run-stale", [], DAY_MS);
		ports.folders.add("run-fresh", [], 9 * DAY_MS);
		expect(await sweep()).toEqual({ removed: ["run-stale"], kept: 0 });
		expect(await ports.removed()).toEqual([]);
	});

	test("does nothing while the switch is off", async () => {
		const { ports, sweep } = await setup();
		ports.ground.cleanUpRuns = false;
		ports.folders.add("run-stale", [], DAY_MS);
		expect(await sweep()).toEqual({ removed: [], kept: 0 });
		expect(ports.folders.removed).toEqual([]);
	});
});
