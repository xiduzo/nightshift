import { describe, expect, test } from "bun:test";
import type { Actor } from "../../../contract";
import { inMemoryCleanupPorts } from "../adapters/out/in-memory-neighbours";
import { listRunFiles } from "./list-run-files";

/** The files of a run's folder for an actor, on in-memory adapters. The clock is at day 10, `cleanUpAfterDays` is 7. */

const ADA: Actor = { personId: "person-ada", door: "session" };
const DAY_MS = 24 * 60 * 60_000;
const REPORT = { path: "report.md", size: 3, modifiedAt: 1 };

function setup() {
	const ports = inMemoryCleanupPorts();
	return { ports, list: listRunFiles(ports) };
}

describe("listRunFiles", () => {
	test("opens the run for the actor first, then reads its row and its state", async () => {
		const { ports, list } = setup();
		ports.runs.add({ id: "run-1", runFolder: true, endedAt: DAY_MS });
		ports.folders.add("run-1", [REPORT]);
		expect(await list(ADA, { runId: "run-1", spaceId: "space-1" })).toEqual({
			here: true,
			files: [REPORT],
			more: false,
			cleanupAt: 8 * DAY_MS,
			removed: null,
		});
		expect(ports.access.opened).toEqual([
			{ actor: ADA, runId: "run-1", spaceId: "space-1" },
		]);
		expect(ports.runs.reads).toEqual(["row run-1", "state run-1"]);
	});

	test("a run the actor may not see is refused before any read", async () => {
		const { ports, list } = setup();
		ports.runs.add({ id: "run-1", runFolder: true });
		ports.access.refuse(new Error("not found"));
		await expect(
			list(ADA, { runId: "run-1", spaceId: "space-1" }),
		).rejects.toThrow("not found");
		expect(ports.runs.reads).toEqual([]);
	});

	test("a run that works in a copy of the project, or that this computer does not know, has no files", async () => {
		const { ports, list } = setup();
		ports.runs.add({ id: "run-copy" });
		const none = {
			here: false,
			files: [],
			more: false,
			cleanupAt: null,
			removed: null,
		};
		expect(await list(ADA, { runId: "run-copy" })).toEqual(none);
		expect(await list(ADA, { runId: "run-gone" })).toEqual(none);
	});

	test("an open run, or the switch off, has no cleanup date", async () => {
		const { ports, list } = setup();
		ports.runs.add({
			id: "run-1",
			runFolder: true,
			status: "running",
			endedAt: null,
		});
		ports.folders.add("run-1", [REPORT]);
		expect((await list(ADA, { runId: "run-1" })).cleanupAt).toBeNull();
		ports.runs.add({ id: "run-2", runFolder: true });
		ports.folders.add("run-2", [REPORT]);
		ports.ground.cleanUpRuns = false;
		expect((await list(ADA, { runId: "run-2" })).cleanupAt).toBeNull();
	});

	test("a folder that went says when, and who removed it", async () => {
		const { ports, list } = setup();
		ports.runs.add({ id: "run-1", runFolder: true });
		ports.removalLog.at = 42;
		await ports.removalLog.removed({
			projectId: "project-1",
			runId: "run-1",
			worktreePath: "/data/run-folders/run-1",
			branches: [],
			by: "cleanup",
		});
		expect((await list(ADA, { runId: "run-1" })).removed).toEqual({
			at: 42,
			by: "cleanup",
		});
	});
});
