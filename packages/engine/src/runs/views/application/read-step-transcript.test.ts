import { describe, expect, test } from "bun:test";
import { runRecord } from "../../../access/adapters/out/in-memory-run-records";
import { NIGHT_SHIFT } from "../../../contract";
import type { TranscriptEntry } from "../../../log";
import { inMemoryViewsPorts } from "../adapters/out/in-memory-neighbours";
import { readStepTranscript } from "./read-step-transcript";

/** A step's saved transcript for an actor, on in-memory adapters. */

const SPACE = "space-1";
const ADA = { personId: "person-ada", door: "session" as const };

const entry = (seq: number): TranscriptEntry => ({
	seq,
	stepId: "step-1",
	sessionId: null,
	at: seq,
	event: { type: "command-output", stream: "stdout", text: `${seq}` },
});

/** A run with one step that ended. The peers hold two entries of it, this computer one. */
function setup() {
	const asked: string[] = [];
	const ports = inMemoryViewsPorts({
		stepEntries: async function* (step) {
			asked.push(step.stepId);
			yield* [entry(1), entry(2)];
		},
		ownEntries: async () => [entry(1)],
	});
	ports.addRun(runRecord({ id: "run-1", spaceId: SPACE }));
	for (const type of ["StepStarted", "StepEnded"] as const) {
		ports.views.append(
			type === "StepStarted"
				? {
						type,
						runId: "run-1",
						stepId: "step-1",
						payload: {
							nodeId: "a",
							nodeType: "agent",
							visit: 1,
							transcriptPath: "/t/step-1",
							logPath: null,
						},
					}
				: {
						type,
						runId: "run-1",
						stepId: "step-1",
						payload: { outcome: "fail", outputs: {}, error: null },
					},
		);
	}
	return { ports, asked, read: readStepTranscript(ports) };
}

describe("readStepTranscript", () => {
	test("a step that ended: all of it, for Night Shift and a Member", async () => {
		const { ports, asked, read } = setup();
		const signal = new AbortController().signal;
		const whole = { entries: [entry(1), entry(2)], holds: "whole" as const };
		expect(
			await read(NIGHT_SHIFT, { runId: "run-1", stepId: "step-1", signal }),
		).toEqual(whole);
		ports.access.members.join(SPACE, ADA.personId, "viewer");
		expect(
			await read(ADA, {
				runId: "run-1",
				spaceId: SPACE,
				stepId: "step-1",
				signal,
			}),
		).toEqual(whole);
		expect(asked).toEqual(["step-1", "step-1"]);
	});

	test("a Person who is not a Member does not find the run, and nothing is read", async () => {
		const { asked, read } = setup();
		await expect(
			read(ADA, {
				runId: "run-1",
				stepId: "step-1",
				signal: new AbortController().signal,
			}),
		).rejects.toMatchObject({ kind: "not-found" });
		expect(asked).toEqual([]);
	});
});
