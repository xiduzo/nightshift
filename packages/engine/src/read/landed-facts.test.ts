import { describe, expect, test } from "bun:test";

import type { EnginePayloads, LandedRunEvent } from "../log";
import { landedFacts } from "./landed-facts";

/*
 * What each landed run event means to a reader of the landed feed: the
 * notifier, keep this computer awake, the exchange's wait for new rows.
 */

let seq = 0;

function landed<T extends keyof EnginePayloads>(
	type: T,
	payload: EnginePayloads[T],
	stepId: string | null = "s1",
): LandedRunEvent {
	seq++;
	return {
		seq,
		runId: "r1",
		stepId,
		sessionId: null,
		type,
		payload,
		at: seq,
		spaceId: "space-1",
		walkerId: "w1",
		walkerSeq: seq,
	} as LandedRunEvent;
}

const wait = (
	extra: Partial<EnginePayloads["WaitStarted"]> = {},
): EnginePayloads["WaitStarted"] => ({
	reason: "device-offline",
	until: null,
	message: "",
	since: 0,
	...extra,
});

describe("landedFacts", () => {
	test("a score says what it scores, its value and its label", () => {
		const [fact] = landedFacts([
			landed("Scored", {
				score: "gate_decision",
				value: 1,
				label: "approve",
				by: "person",
			}),
		]);
		expect(fact).toMatchObject({
			kind: "scored",
			stepId: "s1",
			score: "gate_decision",
			value: 1,
			label: "approve",
			changes: "detail",
		});
	});

	test("a wait for a Device names the Device, or nothing", () => {
		const [named, unnamed, empty] = landedFacts([
			landed("WaitStarted", wait({ deviceName: "Laptop" })),
			landed("WaitStarted", wait()),
			landed("WaitStarted", wait({ deviceName: "" })),
		]);
		expect(named).toMatchObject({
			kind: "wait-started",
			spaceId: "space-1",
			runId: "r1",
			stepId: "s1",
			reason: "device-offline",
			deviceName: "Laptop",
			changes: "summary",
		});
		expect(unnamed).toMatchObject({ kind: "wait-started", deviceName: null });
		expect(empty).toMatchObject({ kind: "wait-started", deviceName: null });
	});

	test("a run's end carries its status and seq", () => {
		const event = landed(
			"RunEnded",
			{ status: "failed", reason: "boom" },
			null,
		);
		expect(landedFacts([event])).toEqual([
			{
				kind: "run-ended",
				status: "failed",
				spaceId: "space-1",
				runId: "r1",
				seq: event.seq,
				changes: "summary",
			},
		]);
	});

	test("Gates, waits and step ends of a step, in the landing's order", () => {
		const facts = landedFacts([
			landed("GateOpened", { question: "Ship?", choices: [] }),
			landed("WaitEnded", { early: false }),
			landed("StepEnded", { outcome: "pass", outputs: {}, error: null }),
		]);
		expect(facts.map((f) => f.kind)).toEqual([
			"gate-opened",
			"wait-ended",
			"step-ended",
		]);
	});

	test("an event of no step is another fact of the run", () => {
		expect(
			landedFacts([landed("WaitEnded", { early: false }, null)]),
		).toMatchObject([{ kind: "other", changes: "summary" }]);
	});

	test("a list of runs changes when a run starts, sleeps, wakes, moves, stops, ends, or a step starts or ends", () => {
		const types = [
			"RunStarted",
			"RunResumed",
			"RunEnded",
			"StepStarted",
			"StepReopened",
			"StepEnded",
			"GateOpened",
			"WaitStarted",
			"WaitEnded",
			"WalkerMoved",
			"HandedOff",
			"StopRequested",
			"StopAfterStepRequested",
			"StopAfterStepCancelled",
		] as const;
		const facts = landedFacts(
			types.map((type) =>
				landed(
					type,
					(type === "RunEnded" ? { status: "stopped" } : {}) as never,
				),
			),
		);
		expect(new Set(facts.map((f) => f.changes))).toEqual(new Set(["summary"]));
	});

	test("what each event changes: the summary, the page, or the spend", () => {
		const facts = landedFacts([
			landed("WalkerMoved", { from: "a", to: "b" } as never, null),
			landed("EdgeTaken", {} as never),
			landed("SessionUsage", {} as never),
		]);
		expect(facts.map((f) => [f.kind, f.changes])).toEqual([
			["other", "summary"],
			["other", "detail"],
			["other", "spend"],
		]);
	});
});
