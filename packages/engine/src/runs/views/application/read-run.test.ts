import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import { runRecord } from "../../access/adapters/out/in-memory-run-records";
import { inMemoryViewsPorts } from "../adapters/out/in-memory-neighbours";
import { readRun } from "./read-run";

/** The run page for an actor, on in-memory adapters. */

const SPACE = "space-1";
const OTHER = "space-2";
const ADA = { personId: "person-ada", door: "session" as const };
const NOT_FOUND = {
	kind: "not-found",
	message: "Night Shift cannot find this run.",
};

/** One run of `SPACE` on a Device of Ada's, with one step, and one run of `OTHER`. */
function setup() {
	const ports = inMemoryViewsPorts();
	ports.views.project("project-1");
	ports.addRun(
		runRecord({
			id: "run-1",
			spaceId: SPACE,
			worktreePath: "/work/1",
			deviceId: "ada-laptop",
		}),
	);
	ports.addRun(runRecord({ id: "run-2", spaceId: OTHER }));
	ports.views.append({
		type: "StepStarted",
		runId: "run-1",
		stepId: "step-1",
		payload: {
			nodeId: "a",
			nodeType: "agent",
			visit: 1,
			transcriptPath: "/t/step-1",
			logPath: null,
		},
	});
	return { ports, read: readRun(ports) };
}

describe("readRun", () => {
	test("Night Shift reads the run page of any run, with its path", async () => {
		const { read } = setup();
		const detail = await read(NIGHT_SHIFT, { runId: "run-1" });
		expect(detail.id).toBe("run-1");
		expect(detail.steps.map((s) => s.id)).toEqual(["step-1"]);
		expect(detail.worktreePath).toBe("/work/1");
	});

	test("a Member reads it; the path only on a Device they own", async () => {
		const { ports, read } = setup();
		ports.access.members.join(SPACE, ADA.personId, "viewer");
		expect((await read(ADA, { runId: "run-1" })).worktreePath).toBe("");
		ports.paths.own("ada-laptop", ADA.personId);
		const own = await read(ADA, { runId: "run-1", spaceId: SPACE });
		expect(own.worktreePath).toBe("/work/1");
		expect(ports.paths.asked.at(-1)).toEqual({ spaceId: SPACE, actor: ADA });
	});

	test("a run of a Space the Person is not a Member of is not found", async () => {
		const { ports, read } = setup();
		ports.access.members.join(OTHER, ADA.personId, "owner");
		await expect(read(ADA, { runId: "run-1" })).rejects.toMatchObject(
			NOT_FOUND,
		);
	});

	test("a run of another Space than the view's is not found", async () => {
		const { read } = setup();
		await expect(
			read(NIGHT_SHIFT, { runId: "run-2", spaceId: SPACE }),
		).rejects.toMatchObject(NOT_FOUND);
		await expect(
			read(NIGHT_SHIFT, { runId: "run-gone" }),
		).rejects.toMatchObject(NOT_FOUND);
	});
});
