import { describe, expect, test } from "bun:test";
import type { Actor } from "../../../contract";
import { inMemoryCleanupPorts } from "../adapters/out/in-memory-neighbours";
import { readRunFile } from "./read-run-file";

/** One file of a run's folder for an actor, on in-memory adapters. */

const ADA: Actor = { personId: "person-ada", door: "session" };
const REPORT = { path: "report.md", size: 3, modifiedAt: 1 };

describe("readRunFile", () => {
	test("opens the run for the actor, then gives the file and where it is", async () => {
		const ports = inMemoryCleanupPorts();
		ports.folders.add("run-1", [REPORT]);
		const read = readRunFile(ports);
		expect(
			await read(ADA, {
				runId: "run-1",
				spaceId: "space-1",
				path: "report.md",
			}),
		).toEqual({ file: REPORT, path: "/data/run-folders/run-1/report.md" });
		expect(ports.access.opened).toEqual([
			{ actor: ADA, runId: "run-1", spaceId: "space-1" },
		]);
		expect(await read(ADA, { runId: "run-1", path: "other.md" })).toBeNull();
	});

	test("a run the actor may not see is refused", async () => {
		const ports = inMemoryCleanupPorts();
		ports.folders.add("run-1", [REPORT]);
		ports.access.refuse(new Error("not found"));
		await expect(
			readRunFile(ports)(ADA, { runId: "run-1", path: "report.md" }),
		).rejects.toThrow("not found");
	});
});
