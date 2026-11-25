import { describe, expect, test } from "bun:test";

import { runEvents } from "../../testing/run-events";
import { DEFAULT_RESUME_PROMPT } from "../context/context";
import { resumePrompt } from "./resume-prompt";

type Log = ReturnType<typeof runEvents>;

/** A step `s1` whose first session `h1` got its prompt. */
const worked = () => {
	const log = runEvents().runStarted().stepStarted("s1", "worker");
	return session(log, "first");
};
const session = (log: Log, id: string) => {
	log.sessionStarted("s1", id);
	return log.push(
		"HarnessSessionAssigned",
		{ harnessSessionId: "h1", model: null },
		{ stepId: "s1", sessionId: id },
	);
};
/** A session the harness did not name, and how it ended. */
const unnamed = (log: Log, outcome: "stopped" | "interrupted" | "failed") =>
	log.sessionStarted("s1", "nameless").push(
		"SessionEnded",
		{
			outcome,
			error: null,
			errorKind: null,
			usage: null,
			costUsd: null,
			resetAt: null,
		},
		{ stepId: "s1", sessionId: "nameless" },
	);
const told = (log: Log, prompt: string, stepId = "s1") =>
	log.resumed("worker", stepId, { prompt, by: "person" });
const reopened = (log: Log, prompt: string) =>
	log.push("StepReopened", { prompt }, { stepId: "s1" });
const promptOf = (log: Log, answer?: string) => {
	const run = log.state();
	const step = run.steps.get("s1");
	if (!step) throw new Error("no step");
	return resumePrompt(run, step, answer);
};

describe("what a session was told and did not get yet", () => {
	test("nothing: the default", () => {
		expect(promptOf(worked())).toBe(DEFAULT_RESUME_PROMPT);
		expect(promptOf(told(worked(), DEFAULT_RESUME_PROMPT))).toBe(
			DEFAULT_RESUME_PROMPT,
		);
	});

	test("the prompt of a Continue, until a named session of the step took it", () => {
		const log = told(worked(), "First.");
		expect(promptOf(log)).toBe("First.");
		expect(promptOf(reopened(log, "First."))).toBe("First.");
		expect(promptOf(session(log, "second"))).toBe(DEFAULT_RESUME_PROMPT);
		expect(promptOf(told(log, "Second."))).toBe("Second.");
	});

	test("two Continues before the session got one: both, in order, and once", () => {
		const log = reopened(told(worked(), "First."), "First.");
		expect(promptOf(told(log, "Second."))).toBe("First.\n\nSecond.");
		expect(promptOf(told(log, DEFAULT_RESUME_PROMPT))).toBe(
			"First.\n\nSecond.",
		);
	});

	test("another step's prompt, and a run again's, are not this step's", () => {
		const log = told(worked(), "For the other.", "s2");
		log.resumed("worker", "s1", { prompt: "Again.", action: "rerun" });
		expect(promptOf(log)).toBe(DEFAULT_RESUME_PROMPT);
	});

	test("the prompt of a person who woke the step", () => {
		const log = worked();
		log.push(
			"WaitEnded",
			{ early: true, by: "person", prompt: "Now." },
			{ stepId: "s1" },
		);
		expect(promptOf(log)).toBe("Now.");
		expect(promptOf(told(log, "And test it."))).toBe("Now.\n\nAnd test it.");
	});

	test("the answer at the step's Gate, and after the reopen that took it, the reopen's", () => {
		const log = worked().gateOpened("s1");
		expect(promptOf(log, "Postgres.")).toBe("Postgres.");
		expect(promptOf(told(log, "Hurry."), "Postgres.")).toBe(
			"Postgres.\n\nHurry.",
		);
		reopened(log, "Postgres.\n\nHurry.");
		expect(promptOf(log)).toBe("Postgres.\n\nHurry.");
	});

	test("a session with no name: again after a crash or a failure, not after a person's stop", () => {
		const opened = () => reopened(told(worked(), "First."), "First.");
		expect(promptOf(opened().sessionStarted("s1", "open"))).toBe("First.");
		expect(promptOf(unnamed(opened(), "interrupted"))).toBe("First.");
		expect(promptOf(unnamed(opened(), "failed"))).toBe("First.");
		const stopped = unnamed(opened(), "stopped");
		expect(promptOf(stopped)).toBe(DEFAULT_RESUME_PROMPT);
		expect(promptOf(told(stopped, "Second."))).toBe("Second.");
	});
});
