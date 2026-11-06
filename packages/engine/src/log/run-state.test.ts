import { describe, expect, test } from "bun:test";
import { runEvents as log } from "../testing/run-events";
import { foldRun, nextState, type RunState } from "./run-state";

/*
 * The folded facts of the run state: its status, its end, the Gates it
 * waits at and the wait it sleeps in. A test here proves what the fold
 * decides once, so no reader derives it again. The views of the state are
 * tested in `read/run-state.test.ts`.
 */

/** The folded facts of a state, as a reader sees them. */
function facts(state: RunState) {
	return {
		status: state.status,
		end: state.end,
		gates: state.gates,
		gate: state.gate,
		sleep: state.sleep,
		latest: state.latest,
	};
}

/** A log that passes through every status, with two branches at Gates and a step that sleeps. */
function eventfulLog() {
	return log()
		.runStarted()
		.stepStarted("s1", "worker")
		.sessionStarted("s1", "a")
		.sessionEnded("s1", "a")
		.stepEnded("s1")
		.edge("e1", "worker", "gate")
		.stepStarted("g1", "gate")
		.stepStarted("g2", "gate")
		.gateOpened("g2", "Second?")
		.gateOpened("g1", "First?")
		.stepEnded("g1", "approve")
		.ended("stopped")
		.resumed("gate")
		.stepStarted("g2", "gate", 2)
		.gateOpened("g2", "Again?")
		.stepEnded("g2", "approve")
		.stepStarted("w1", "wait")
		.waitStarted("w1", { reason: "command", until: 5000, signal: "go" })
		.waitEnded("w1")
		.waitStarted("w1", { reason: "usage-limit", until: 9000 })
		.stepEnded("w1")
		.stepStarted("a1", "worker")
		.gateOpened("a1", "Ask?")
		.stepReopened("a1")
		.stepEnded("a1")
		.ended("finished", null, "done");
}

describe("the folded facts", () => {
	test("a run without a run event is interrupted, with no end, Gate or sleep", () => {
		expect(facts(foldRun([]))).toEqual({
			status: "interrupted",
			end: null,
			gates: [],
			gate: null,
			sleep: null,
			latest: null,
		});
	});

	test("the status follows the open Gates, the sleep and the end", () => {
		const b = log().runStarted().stepStarted("g1", "gate");
		expect(b.state().status).toBe("running");
		b.gateOpened("g1");
		expect(b.state()).toMatchObject({
			status: "waiting",
			gate: { stepId: "g1" },
			sleep: null,
		});
		b.stepEnded("g1", "approve").stepStarted("w1", "wait").waitStarted("w1");
		expect(b.state()).toMatchObject({
			status: "sleeping",
			gate: null,
			sleep: { stepId: "w1", reason: "command", until: 9999 },
		});
		b.waitEnded("w1");
		expect(b.state()).toMatchObject({ status: "running", sleep: null });
		b.ended("failed", "The step failed.");
		expect(b.state()).toMatchObject({
			status: "failed",
			end: {
				status: "failed",
				reason: "The step failed.",
				result: null,
				endReason: "_OTHER",
			},
			gates: [],
			sleep: null,
		});
	});

	test("every Gate a branch waits at is open, in the order the steps started", () => {
		const b = log()
			.runStarted()
			.stepStarted("g1", "gate")
			.stepStarted("g2", "gate")
			.gateOpened("g2", "Second?")
			.gateOpened("g1", "First?");
		expect(b.state().gates.map((g) => g.stepId)).toEqual(["g1", "g2"]);
		expect(b.state().gate?.stepId).toBe("g2");
		b.stepEnded("g2", "approve");
		expect(b.state().gates.map((g) => g.stepId)).toEqual(["g1"]);
	});

	test("a run event closes every Gate and wait of the walk before it", () => {
		const b = log()
			.runStarted()
			.stepStarted("g1", "gate")
			.gateOpened("g1")
			.ended("stopped");
		expect(b.state()).toMatchObject({
			status: "stopped",
			gates: [],
			gate: null,
		});
		b.resumed("gate");
		// The Gate opened before the resume: the step must ask again.
		expect(b.state()).toMatchObject({ status: "running", gate: null });
	});

	test("an end logged without its reason gets the proved one", () => {
		const nothing = log()
			.runStarted()
			.ended("finished", "No open issues", "nothing-to-do");
		expect(nothing.state().end?.endReason).toBe("finished");
		const stopped = log().runStarted().ended("stopped");
		expect(stopped.state().end?.endReason).toBe("stopped_by_person");
	});

	test("the facts after each event are the same folded at once or one event at a time", () => {
		const { events } = eventfulLog();
		let state = foldRun([]);
		for (const [i, e] of events.entries()) {
			const next = nextState(state, e);
			expect(next).not.toBeNull();
			state = next as RunState;
			expect(facts(state)).toEqual(facts(foldRun(events.slice(0, i + 1))));
		}
		expect(state.status).toBe("finished");
	});

	test("the folded facts agree with each other after every event", () => {
		const { events } = eventfulLog();
		const seen = new Set<string>();
		for (let i = 1; i <= events.length; i++) {
			const state = foldRun(events.slice(0, i));
			seen.add(state.status);
			expect(state.gate).toBe(state.gates.at(-1) ?? null);
			expect(state.status === "waiting").toBe(state.gate !== null);
			expect(state.status === "sleeping").toBe(state.sleep !== null);
			expect(state.end !== null).toBe(
				state.status !== "running" &&
					state.status !== "waiting" &&
					state.status !== "sleeping",
			);
		}
		expect([...seen].sort()).toEqual([
			"finished",
			"running",
			"sleeping",
			"stopped",
			"waiting",
		]);
	});

	test("an event that is not the latest gives no next state", () => {
		const { events } = log().runStarted().stepStarted("s1", "worker");
		const state = foldRun(events);
		expect(nextState(state, events[0] as (typeof events)[number])).toBeNull();
	});
});
