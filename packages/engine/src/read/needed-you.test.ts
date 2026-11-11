import { describe, expect, test } from "bun:test";

import { runEvents as log } from "../testing/run-events";
import { neededYouOf } from "./needed-you";
import { runFacts } from "./read-model";

/*
 * Needed you: only what a person did to a run counts. Each test builds a
 * log, folds it, and reads why the run needed a person.
 */

const reasons = (b: ReturnType<typeof log>) =>
	neededYouOf(b.state()).map(({ reason }) => reason);

describe("what a person did to a run", () => {
	test("a run that walked on its own needed nobody", () => {
		const b = log()
			.runStarted()
			.stepStarted("s1", "worker")
			.stepEnded("s1")
			.ended("finished");
		expect(neededYouOf(b.state())).toEqual([]);
		expect(runFacts(b.state()).neededYou).toEqual([]);
	});

	test("a Gate counts once a person answered it, not while it waits", () => {
		const b = log().runStarted().stepStarted("g1", "gate").gateOpened("g1");
		expect(reasons(b)).toEqual([]);
		b.at(5000).push(
			"Scored",
			{ score: "gate_decision", value: 1, label: "approve", by: "person" },
			{ stepId: "g1" },
		);
		b.stepEnded("g1", "approve");
		expect(neededYouOf(b.state())).toEqual([{ reason: "gate", at: 5000 }]);
	});

	test("a deadline that chose for nobody does not count", () => {
		const b = log()
			.runStarted()
			.stepStarted("g1", "gate")
			.gateOpened("g1")
			.push(
				"Scored",
				{ score: "gate_decision", value: 1, label: "approve", by: "deadline" },
				{ stepId: "g1" },
			)
			.stepEnded("g1", "approve");
		expect(reasons(b)).toEqual([]);
	});

	test("an Ask a person answered counts as an ask", () => {
		const b = log()
			.runStarted()
			.stepStarted("g1", "gate")
			.push(
				"GateOpened",
				{
					question: "Which tone?",
					choices: [{ name: "answer" }],
					form: { fields: [] } as never,
				},
				{ stepId: "g1" },
			)
			.push(
				"Scored",
				{ score: "gate_decision", value: 1, label: "answer", by: "person" },
				{ stepId: "g1" },
			)
			.stepEnded("g1", "answer");
		expect(reasons(b)).toEqual(["ask"]);
	});

	test("a person's resume counts, the daemon's resume does not", () => {
		const b = log()
			.runStarted()
			.ended("interrupted")
			.resumed("worker", null, { by: "daemon" })
			.ended("failed")
			.resumed("worker")
			.ended("stopped")
			.resumed("worker", null, { by: "person", action: "rerun" });
		expect(reasons(b)).toEqual(["resumed", "resumed"]);
	});

	test("a wake a person asked for counts, a signal and Night Shift's own do not", () => {
		const b = log()
			.runStarted()
			.stepStarted("w1", "worker")
			.waitStarted("w1", { reason: "duration" })
			.push("WaitEnded", { early: true, by: "person" }, { stepId: "w1" })
			.waitStarted("w1", { reason: "signal", signal: "deploy" })
			.push("WaitEnded", { early: true, signal: "deploy" }, { stepId: "w1" })
			.waitStarted("w1", { reason: "device-offline" })
			.push("WaitEnded", { early: true, by: "daemon" }, { stepId: "w1" })
			.waitStarted("w1", { reason: "duration" })
			.waitEnded("w1");
		expect(reasons(b)).toEqual(["resumed"]);
	});

	test("an older wake without who: a person, unless only Night Shift wakes that sleep", () => {
		const b = log()
			.runStarted()
			.stepStarted("w1", "worker")
			.waitStarted("w1", { reason: "usage-limit" })
			.push("WaitEnded", { early: true }, { stepId: "w1" })
			.waitStarted("w1", { reason: "lease" })
			.push("WaitEnded", { early: true }, { stepId: "w1" });
		expect(reasons(b)).toEqual(["resumed"]);
	});

	test("a person's stop counts, a stop of Night Shift does not", () => {
		const b = log()
			.runStarted()
			.push("StopRequested", { by: "daemon" })
			.ended("stopped")
			.resumed("worker")
			.push("StopRequested", { by: "person" })
			.ended("stopped");
		expect(reasons(b)).toEqual(["resumed", "stopped"]);
	});

	test("a restart counts as resumed, not as a stop", () => {
		const b = log()
			.runStarted()
			.stepStarted("s1", "worker")
			.push("StopRequested", { by: "person", restart: true })
			.stepEnded("s1", "stopped")
			.ended("stopped")
			.resumed("worker", "s1", { by: "person", action: "restart" });
		expect(reasons(b)).toEqual(["resumed"]);
	});

	test("an older log: a stop without who is a person's, and the stop a restart follows is the restart's", () => {
		const b = log()
			.runStarted()
			.stepStarted("s1", "worker")
			.push("StopRequested", {})
			.stepEnded("s1", "stopped")
			.ended("stopped")
			.resumed("worker", "s1", { action: "restart" })
			.push("StopRequested", {})
			.ended("stopped");
		expect(reasons(b)).toEqual(["resumed", "stopped"]);
	});

	test("a stop after the step counts, unless the person withdrew it", () => {
		const withdrawn = log()
			.runStarted()
			.push("StopAfterStepRequested", {})
			.push("StopAfterStepCancelled", {});
		expect(reasons(withdrawn)).toEqual([]);
		const kept = log().runStarted().push("StopAfterStepRequested", {});
		expect(reasons(kept)).toEqual(["stopped"]);
	});

	test("each end of the run's trace says whether a person stepped in by then", () => {
		const b = log()
			.runStarted()
			.ended("failed")
			.resumed("worker")
			.ended("finished");
		expect(b.trace()?.ends.map((end) => end.neededYou)).toEqual([false, true]);
	});

	test("a take-over counts, and every reason comes in the order it happened", () => {
		const b = log()
			.runStarted()
			.stepStarted("s1", "worker")
			.at(2000)
			.push(
				"RunTakenOver",
				{ by: "ada", harness: "claude-code" },
				{ stepId: "s1" },
			)
			.at(1500)
			.push("StopRequested", { by: "person" });
		expect(neededYouOf(b.state())).toEqual([
			{ reason: "stopped", at: 1500 },
			{ reason: "took-over", at: 2000 },
		]);
		expect(b.trace()?.neededYou).toEqual(neededYouOf(b.state()));
	});
});
