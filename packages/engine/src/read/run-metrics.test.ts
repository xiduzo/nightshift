import { describe, expect, test } from "bun:test";
import type {
	EngineEventType,
	EnginePayloads,
	LoggedEvent,
} from "../log/events";
import { NO_COST } from "./cost";
import { deriveSteps, sumCost } from "./derive-steps";
import { runFacts } from "./read-model";
import {
	costBasis,
	pullRequestOf,
	runMetrics,
	stepMetrics,
} from "./run-metrics";

/** A run's log, shape only. Each event gets the next seq at the time given. */
function log() {
	const events: LoggedEvent[] = [];
	const at = <T extends EngineEventType>(
		time: number,
		type: T,
		payload: EnginePayloads[T],
		ids: { stepId?: string; sessionId?: string } = {},
	) => {
		events.push({
			seq: events.length + 1,
			runId: "run-1",
			stepId: ids.stepId ?? null,
			sessionId: ids.sessionId ?? null,
			type,
			payload,
			at: time,
		} as LoggedEvent);
		return builder;
	};
	const builder = {
		events,
		at,
		started: (time: number) =>
			at(time, "RunStarted", {
				projectId: "p",
				flowName: "f",
				title: "f",
				start: "a",
			}),
		step: (time: number, stepId: string, nodeId: string, visit = 1) =>
			at(
				time,
				"StepStarted",
				{
					nodeId,
					nodeType: "agent",
					visit,
					transcriptPath: "t",
					logPath: null,
				},
				{ stepId },
			),
		ended: (
			time: number,
			stepId: string,
			outputs: EnginePayloads["StepEnded"]["outputs"] = {},
		) =>
			at(
				time,
				"StepEnded",
				{ outcome: "pass", outputs, error: null },
				{ stepId },
			),
		session: (time: number, stepId: string, sessionId: string) =>
			at(
				time,
				"SessionStarted",
				{ prompt: "p", resumeSessionId: null },
				{ stepId, sessionId },
			),
		sessionEnded: (
			time: number,
			stepId: string,
			sessionId: string,
			cost: Partial<EnginePayloads["SessionEnded"]> = {},
		) =>
			at(
				time,
				"SessionEnded",
				{
					outcome: "finished",
					error: null,
					errorKind: null,
					usage: {
						inputTokens: 1000,
						outputTokens: 200,
						cacheReadTokens: 600,
						cacheWriteTokens: 100,
					},
					costUsd: 0.5,
					costSource: "reported",
					resetAt: null,
					...cost,
				},
				{ stepId, sessionId },
			),
		gate: (time: number, stepId: string) =>
			at(time, "GateOpened", { question: "Ship?", choices: [] }, { stepId }),
		runEnded: (time: number) =>
			at(time, "RunEnded", { status: "finished", reason: null }),
	};
	return builder;
}

const PR = "https://github.com/acme/app/pull/7";

describe("costBasis", () => {
	test("is billed when every call reported its cost, or nothing could cost", () => {
		expect(costBasis(NO_COST)).toBe("billed");
		expect(costBasis({ usd: 1, estimated: false, missing: 0, calls: 2 })).toBe(
			"billed",
		);
	});

	test("is estimated when part of it is priced from tokens", () => {
		expect(costBasis({ usd: 1, estimated: true, missing: 0, calls: 2 })).toBe(
			"estimated",
		);
	});

	test("is unknown when a call ended without a cost, estimated or not", () => {
		expect(costBasis({ usd: 1, estimated: true, missing: 1, calls: 2 })).toBe(
			"unknown",
		);
	});
});

describe("pullRequestOf", () => {
	test("finds the GitHub kit's pull request in its data", () => {
		expect(pullRequestOf({ data: { number: 7, url: PR, created: true } })).toBe(
			PR,
		);
	});

	test("finds a pull request a command printed last", () => {
		expect(
			pullRequestOf({
				log_tail: `Creating pull request for feature into main\n\n${PR}\n`,
			}),
		).toBe(PR);
	});

	test("does not take a pull request named in passing", () => {
		expect(
			pullRequestOf({
				summary: `I read ${PR} and fixed the bug.`,
				log_tail: `See ${PR}\ndone`,
				data: { issue: "https://github.com/acme/app/issues/3" },
			}),
		).toBeNull();
	});
});

describe("stepMetrics", () => {
	test("adds up the sessions' time and tokens, and the Gate's wait", () => {
		const l = log()
			.started(0)
			.step(10, "s1", "a")
			.session(20, "s1", "x1")
			.sessionEnded(120, "s1", "x1")
			.gate(130, "s1")
			.at(530, "StepReopened", { prompt: "go on" }, { stepId: "s1" })
			.session(540, "s1", "x2")
			.sessionEnded(640, "s1", "x2", { costSource: "estimated" })
			.ended(650, "s1", { data: { url: PR } });
		const [step] = deriveSteps(l.events);
		if (!step) throw new Error("no step");
		expect(stepMetrics(step)).toEqual({
			wallMs: 640,
			agentMs: 200,
			gateWaitMs: 400,
			tokens: { input: 2000, output: 400, cacheRead: 1200, cacheWrite: 200 },
			costBasis: "estimated",
			prUrl: PR,
		});
	});

	test("counts a running session until its latest event, and no wall time yet", () => {
		const l = log()
			.started(0)
			.step(10, "s1", "a")
			.session(20, "s1", "x1")
			.at(
				80,
				"SessionUsage",
				{
					usage: { inputTokens: 50, outputTokens: 5 },
					costUsd: null,
				},
				{ stepId: "s1", sessionId: "x1" },
			);
		const [step] = deriveSteps(l.events);
		if (!step) throw new Error("no step");
		expect(stepMetrics(step)).toMatchObject({
			wallMs: null,
			agentMs: 60,
			gateWaitMs: 0,
			tokens: { input: 50, output: 5, cacheRead: 0, cacheWrite: 0 },
			prUrl: null,
		});
	});

	test("does not count a Gate that still waits", () => {
		const l = log().started(0).step(10, "s1", "a").gate(20, "s1");
		const [step] = deriveSteps(l.events);
		if (!step) throw new Error("no step");
		expect(stepMetrics(step).gateWaitMs).toBe(0);
	});

	test("ends a Gate's wait when the run stops", () => {
		const l = log()
			.started(0)
			.step(10, "s1", "a")
			.gate(20, "s1")
			.at(70, "RunEnded", { status: "stopped", reason: null });
		const [step] = deriveSteps(l.events);
		if (!step) throw new Error("no step");
		expect(stepMetrics(step).gateWaitMs).toBe(50);
	});
});

describe("runMetrics", () => {
	const night = () =>
		log()
			.started(1000)
			.step(1010, "s1", "a")
			.session(1020, "s1", "x1")
			.sessionEnded(1100, "s1", "x1")
			.ended(1110, "s1", { data: { url: PR } })
			.step(1120, "s2", "a", 2)
			.session(1130, "s2", "x2")
			.sessionEnded(1200, "s2", "x2", { costUsd: null, usage: null })
			.ended(1210, "s2", {
				log_tail: "https://github.com/acme/app/pull/8",
			})
			.runEnded(1300);

	test("adds up every step, takes the last pull request, and the run's wall time", () => {
		const { events } = night();
		const steps = deriveSteps(events);
		expect(runMetrics(steps, sumCost(events, steps), 1000, 1300)).toEqual({
			wallMs: 300,
			agentMs: 150,
			gateWaitMs: 0,
			tokens: { input: 1000, output: 200, cacheRead: 600, cacheWrite: 100 },
			costBasis: "unknown",
			prUrl: "https://github.com/acme/app/pull/8",
		});
	});

	test("has no wall time while the run is open", () => {
		const { events } = log().started(1000).step(1010, "s1", "a");
		expect(runMetrics(deriveSteps(events), NO_COST, 1000, null).wallMs).toBe(
			null,
		);
	});

	test("rides on the run's facts, as the run list reads them", () => {
		const facts = runFacts(night().events);
		expect(facts.metrics.wallMs).toBe(300);
		expect(facts.metrics.prUrl).toBe("https://github.com/acme/app/pull/8");
		expect(facts.costMissing).toBe(1);
	});
});
