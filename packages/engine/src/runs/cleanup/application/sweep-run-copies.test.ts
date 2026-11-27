import { describe, expect, spyOn, test } from "bun:test";
import { cleanupPorts } from "../test-support";
import { sweepRunCopies } from "./sweep-run-copies";

/** The sweep of run copies and branches, over a database in memory. */

const DAY_MS = 24 * 60 * 60_000;
const REPO = "/work/app";
const RUN = "abcd1234-0000";
const SHORT = "abcd1234";

/** One project with a clone, and one run of it that ended on day 1 (the clock is at day 10). */
async function setup() {
	const ports = await cleanupPorts();
	ports.projects.projects.push({
		id: "project-1",
		spaceId: "space-1",
		repoPath: REPO,
	});
	ports.runs.add({ id: RUN, endedAt: DAY_MS });
	return { ports, sweep: sweepRunCopies(ports) };
}

describe("sweepRunCopies", () => {
	test("removes the copy and the branches of a run that ended a day ago, and logs what went", async () => {
		const { ports, sweep } = await setup();
		ports.branches.leave(REPO, SHORT, {
			head: { commit: "c1", branch: `nightshift/${SHORT}`, unsaved: 0 },
			branches: [{ name: `nightshift/${SHORT}`, commit: "c1", unsaved: 0 }],
		});
		expect(await sweep()).toEqual({ removed: [RUN], expired: [], left: 0 });
		expect(ports.branches.done).toEqual([
			`remove ${REPO}.nightshift/${SHORT}`,
			`delete-branch nightshift/${SHORT}`,
		]);
		expect(await ports.removed()).toEqual([
			{
				projectId: "project-1",
				runId: RUN,
				worktreePath: `${REPO}.nightshift/${SHORT}`,
				branches: [`nightshift/${SHORT}`],
				by: "cleanup",
			},
		]);
	});

	test("keeps changes that are not committed and commits only here before the copy goes", async () => {
		const { ports, sweep } = await setup();
		ports.branches.leave(REPO, SHORT, {
			changes: 2,
			head: { commit: "c1", branch: `nightshift/${SHORT}`, unsaved: 1 },
			branches: [{ name: `nightshift/${SHORT}`, commit: "c1", unsaved: 1 }],
		});
		await sweep();
		const kept = `refs/nightshift/kept/${SHORT}/`;
		expect(ports.branches.done).toEqual([
			`commit ${REPO}.nightshift/${SHORT}`,
			`keep ${kept}copy kept-1`,
			`keep ${kept}heads/nightshift/${SHORT} c1`,
			`remove ${REPO}.nightshift/${SHORT} force`,
			`delete-branch nightshift/${SHORT}`,
		]);
		expect((await ports.removed())[0]?.kept).toEqual([
			`${kept}copy`,
			`${kept}heads/nightshift/${SHORT}`,
		]);
	});

	test("leaves a copy git does not know, an open run and a run at work here", async () => {
		const { ports, sweep } = await setup();
		ports.branches.leave(REPO, SHORT, { registered: false });
		ports.runs.add({ id: "open0000-run", status: "waiting", endedAt: null });
		ports.runs.add({ id: "busy0000-run" });
		ports.runs.active.add("busy0000-run");
		ports.branches.leave(REPO, "open0000");
		ports.branches.leave(REPO, "busy0000");
		expect(await sweep()).toEqual({ removed: [], expired: [], left: 1 });
		expect(ports.branches.done).toEqual([]);
	});

	test("leaves a run that started again while git looked at its copy", async () => {
		const { ports, sweep } = await setup();
		ports.branches.leave(REPO, SHORT, {
			head: { commit: "c1", branch: `nightshift/${SHORT}`, unsaved: 0 },
		});
		const { inspect } = ports.branches;
		ports.branches.inspect = async (...asked) => {
			ports.runs.add({ id: RUN, status: "running", endedAt: null });
			return inspect(...asked);
		};
		expect(await sweep()).toEqual({ removed: [], expired: [], left: 1 });
		expect(ports.branches.done).toEqual([]);
	});

	test("does nothing while the switch is off", async () => {
		const { ports, sweep } = await setup();
		ports.ground.cleanUpRuns = false;
		ports.branches.leave(REPO, SHORT);
		expect(await sweep()).toEqual({ removed: [], expired: [], left: 0 });
		expect(ports.branches.done).toEqual([]);
	});

	test("logs what went when a step fails, and counts the run as left", async () => {
		const { ports, sweep } = await setup();
		ports.branches.leave(REPO, SHORT, {
			head: { commit: "c1", branch: `nightshift/${SHORT}`, unsaved: 0 },
			branches: [{ name: `nightshift/${SHORT}`, commit: "c1", unsaved: 0 }],
		});
		ports.branches.failOn("deleteBranch");
		expect(await sweep()).toEqual({ removed: [], expired: [], left: 1 });
		expect(await ports.removed()).toEqual([
			{
				projectId: "project-1",
				runId: RUN,
				worktreePath: `${REPO}.nightshift/${SHORT}`,
				branches: [],
				by: "cleanup",
			},
		]);
	});

	test("frees the kept work of a run that ended 30 days ago, keeps a younger one, and logs how many went", async () => {
		const { ports, sweep } = await setup();
		// Kept work does not follow the days of run folders.
		ports.ground.cleanUpAfterDays = 90;
		ports.ground.at = 31 * DAY_MS;
		ports.runs.add({ id: "young000-run", endedAt: 5 * DAY_MS });
		const refs = ports.branches.keptRefs(SHORT);
		await ports.branches.keep(REPO, refs.copy, "c1");
		await ports.branches.keep(
			REPO,
			ports.branches.keptRefs("young000").copy,
			"c2",
		);
		ports.branches.done.length = 0;
		const log = spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await sweep()).toEqual({ removed: [], expired: [RUN], left: 0 });
			expect(log.mock.calls).toEqual([
				["[cleanup] freed the kept work of 1 run (30 days after each ended)"],
			]);
		} finally {
			log.mockRestore();
		}
		expect(ports.branches.done).toEqual([`delete-ref ${refs.copy}`]);
		expect(await ports.removed()).toEqual([
			{
				projectId: "project-1",
				runId: RUN,
				worktreePath: null,
				branches: [],
				expired: [refs.copy],
				by: "cleanup",
			},
		]);
	});

	test("frees the kept work of a run this computer does not know 30 days after it was kept", async () => {
		const { ports, sweep } = await setup();
		const gone = "gone0000-run";
		await ports.removalLog.removed({
			projectId: "project-1",
			runId: gone,
			worktreePath: null,
			branches: [],
			kept: [ports.branches.keptRefs("gone0000").copy],
			by: "cleanup",
		});
		await ports.removedAt(2 * DAY_MS);
		const refs = ports.branches.keptRefs("gone0000");
		await ports.branches.keep(REPO, refs.copy, "c1");
		await ports.branches.keep(
			REPO,
			ports.branches.keptRefs("nolog000").copy,
			"c2",
		);
		ports.branches.done.length = 0;
		const log = spyOn(console, "log").mockImplementation(() => {});
		try {
			expect((await sweep()).expired).toEqual([]);
			// A pass that frees nothing stays quiet.
			expect(log).not.toHaveBeenCalled();
		} finally {
			log.mockRestore();
		}
		ports.ground.at = 32 * DAY_MS;
		expect((await sweep()).expired).toEqual([gone]);
		expect(ports.branches.done).toEqual([`delete-ref ${refs.copy}`]);
	});

	test("keeps the kept work of a run that is open again", async () => {
		const { ports, sweep } = await setup();
		ports.ground.at = 40 * DAY_MS;
		ports.runs.add({ id: RUN, status: "running", endedAt: DAY_MS });
		await ports.branches.keep(REPO, ports.branches.keptRefs(SHORT).copy, "c1");
		ports.branches.done.length = 0;
		expect((await sweep()).expired).toEqual([]);
		expect(ports.branches.done).toEqual([]);
	});
});
