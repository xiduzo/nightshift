import { describe, expect, test } from "bun:test";
import { allowing } from "../../../access/adapters/out/in-memory-access";
import { runRecord } from "../../../access/adapters/out/in-memory-run-records";
import { cleanupPorts } from "../test-support";
import { listRunFiles } from "./list-run-files";

/** The files of a run's folder for an actor, over a database in memory. The clock is at day 10, `cleanUpAfterDays` is 7. */

const ADA = { personId: "person-ada", door: "session" as const };
const DAY_MS = 24 * 60 * 60_000;
const REPORT = { path: "report.md", size: 3, modifiedAt: 1 };

/** Every port, with the run `run-1` of `space-1` in access, and `ADA` a viewer there. */
async function seeded() {
	const ports = await cleanupPorts();
	ports.access.members.join("space-1", ADA.personId, "viewer");
	for (const id of ["run-1", "run-2", "run-copy", "run-gone"]) {
		ports.access.runs.add(runRecord({ id, spaceId: "space-1" }));
	}
	return ports;
}

async function setup() {
	const ports = await seeded();
	return { ports, list: listRunFiles(ports) };
}

describe("listRunFiles", () => {
	test("opens the run for the actor first, then reads its row and its state", async () => {
		const { ports, list } = await setup();
		ports.runs.add({ id: "run-1", runFolder: true, endedAt: DAY_MS });
		ports.folders.add("run-1", [REPORT]);
		expect(await list(ADA, { runId: "run-1", spaceId: "space-1" })).toEqual({
			here: true,
			files: [REPORT],
			more: false,
			cleanupAt: 8 * DAY_MS,
			removed: null,
		});
		expect(ports.runs.reads).toEqual(["row run-1", "state run-1"]);
	});

	test("a run that works in a copy of the project, or that this computer does not know, has no files", async () => {
		const { ports, list } = await setup();
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
		const { ports, list } = await setup();
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
		const { ports, list } = await setup();
		ports.runs.add({ id: "run-1", runFolder: true });
		await ports.removalLog.removed({
			projectId: "project-1",
			runId: "run-1",
			worktreePath: "/data/run-folders/run-1",
			branches: [],
			by: "cleanup",
		});
		await ports.removedAt(42);
		expect((await list(ADA, { runId: "run-1" })).removed).toEqual({
			at: 42,
			by: "cleanup",
		});
	});

	test("every Member of the run's Space may, before any read, and nobody else", async () => {
		const { ports, list } = await setup();
		ports.runs.add({ id: "run-1", runFolder: true });
		const asked = ports.access.whoMay(
			"space-1",
			(actor) => list(actor, { runId: "run-1" }),
			() => ports.runs.reads,
		);
		expect(await asked).toEqual(allowing("owner", "admin", "member", "viewer"));
	});

	test("a run of another Space than the one asked for is not found", async () => {
		const { list } = await setup();
		await expect(
			list(ADA, { runId: "run-1", spaceId: "space-2" }),
		).rejects.toMatchObject({ kind: "not-found" });
	});
});
