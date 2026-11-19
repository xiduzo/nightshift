import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import { runRecord } from "../../access/adapters/out/in-memory-run-records";
import { inMemoryViewsPorts } from "../adapters/out/in-memory-neighbours";
import { readStep } from "./read-step";

/** One step of a run for an actor, on in-memory adapters. */

const SPACE = "space-1";
const ADA = { personId: "person-ada" };

function setup() {
	const ports = inMemoryViewsPorts();
	ports.addRun(runRecord({ id: "run-1", spaceId: SPACE }));
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
	return { ports, read: readStep(ports) };
}

describe("readStep", () => {
	test("Night Shift and a Member read a step of the run", async () => {
		const { ports, read } = setup();
		const step = await read(NIGHT_SHIFT, { runId: "run-1", stepId: "step-1" });
		expect(step.id).toBe("step-1");
		expect(step.nodeId).toBe("a");
		ports.access.members.join(SPACE, ADA.personId, "viewer");
		expect(
			(await read(ADA, { runId: "run-1", spaceId: SPACE, stepId: "step-1" }))
				.id,
		).toBe("step-1");
	});

	test("a step the run does not have is not found", async () => {
		const { read } = setup();
		await expect(
			read(NIGHT_SHIFT, { runId: "run-1", stepId: "nope" }),
		).rejects.toMatchObject({
			kind: "not-found",
			message: "Night Shift cannot find this step of the run.",
		});
	});

	test("a Person who is not a Member does not find the run", async () => {
		const { read } = setup();
		await expect(
			read(ADA, { runId: "run-1", stepId: "step-1" }),
		).rejects.toMatchObject({
			kind: "not-found",
			message: "Night Shift cannot find this run.",
		});
	});
});
