import { describe, expect, test } from "bun:test";
import { allowing } from "../../../access/adapters/out/in-memory-access";
import { runRecord } from "../../../access/adapters/out/in-memory-run-records";
import { cleanupPorts } from "../test-support";
import { readRunFile } from "./read-run-file";

/** One file of a run's folder for an actor, over a database in memory. */

const ADA = { personId: "person-ada", door: "session" as const };
const REPORT = { path: "report.md", size: 3, modifiedAt: 1 };

/** Every port, with the run `run-1` of `space-1` in access, and `ADA` a viewer there. */
async function seeded() {
	const ports = await cleanupPorts();
	ports.access.members.join("space-1", ADA.personId, "viewer");
	ports.access.runs.add(runRecord({ id: "run-1", spaceId: "space-1" }));
	return ports;
}

describe("readRunFile", () => {
	test("opens the run for the actor, then gives the file and where it is", async () => {
		const ports = await seeded();
		ports.folders.add("run-1", [REPORT]);
		const read = readRunFile(ports);
		expect(
			await read(ADA, {
				runId: "run-1",
				spaceId: "space-1",
				path: "report.md",
			}),
		).toEqual({ file: REPORT, path: "/data/run-folders/run-1/report.md" });
		expect(await read(ADA, { runId: "run-1", path: "other.md" })).toBeNull();
	});

	test("every Member of the run's Space may, and nobody else", async () => {
		const ports = await seeded();
		ports.folders.add("run-1", [REPORT]);
		expect(
			await ports.access.whoMay("space-1", (actor) =>
				readRunFile(ports)(actor, { runId: "run-1", path: "report.md" }),
			),
		).toEqual(allowing("owner", "admin", "member", "viewer"));
	});

	test("a run of another Space than the one asked for is not found", async () => {
		await expect(
			readRunFile(await seeded())(ADA, {
				runId: "run-1",
				spaceId: "space-2",
				path: "report.md",
			}),
		).rejects.toMatchObject({ kind: "not-found" });
	});
});
