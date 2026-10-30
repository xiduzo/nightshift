import { describe, expect, test } from "bun:test";
import type {
	EngineEventType,
	EnginePayloads,
	LoggedEvent,
} from "../log/events";
import { runTrace } from "./run-trace";

/** A run's log, shape only. Each event gets the next seq at the time given. */
function log() {
	const events: LoggedEvent[] = [];
	const builder = {
		events,
		at<T extends EngineEventType>(
			time: number,
			type: T,
			payload: EnginePayloads[T],
			ids: { stepId?: string; sessionId?: string } = {},
		) {
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
		},
	};
	return builder;
}

const started: EnginePayloads["RunStarted"] = {
	projectId: "p1",
	flowName: "nightly",
	title: "nightly",
	start: "build",
};

const step = (
	nodeId: string,
	nodeType: EnginePayloads["StepStarted"]["nodeType"],
	extra: Partial<EnginePayloads["StepStarted"]> = {},
): EnginePayloads["StepStarted"] => ({
	nodeId,
	nodeType,
	visit: 1,
	transcriptPath: "t",
	logPath: null,
	deviceId: "mac",
	...extra,
});

const ended = (
	outcome: string,
	extra: Partial<EnginePayloads["StepEnded"]> = {},
): EnginePayloads["StepEnded"] => ({
	outcome,
	outputs: {},
	error: null,
	...extra,
});

describe("runTrace", () => {
	test("is null for a log with no run", () => {
		expect(runTrace([])).toBeNull();
	});

	test("gives each step its ends, sessions with harness, model, tokens and cost", () => {
		const { events } = log()
			.at(1000, "RunStarted", started)
			.at(1010, "StepStarted", step("build", "agent"), { stepId: "s1" })
			.at(
				1020,
				"SessionStarted",
				{ prompt: "p", resumeSessionId: null, harness: "claude-code" },
				{ stepId: "s1", sessionId: "x1" },
			)
			.at(
				1021,
				"HarnessSessionAssigned",
				{ harnessSessionId: "h1", model: "claude-sonnet" },
				{ stepId: "s1", sessionId: "x1" },
			)
			.at(
				1100,
				"SessionEnded",
				{
					outcome: "finished",
					error: null,
					errorKind: null,
					usage: { inputTokens: 900, outputTokens: 100, cacheReadTokens: 400 },
					costUsd: 0.25,
					costSource: "reported",
					resetAt: null,
				},
				{ stepId: "s1", sessionId: "x1" },
			)
			.at(1110, "StepEnded", ended("pass"), { stepId: "s1" })
			.at(1200, "RunEnded", { status: "finished", reason: null });

		const trace = runTrace(events);
		expect(trace).not.toBeNull();
		if (!trace) return;
		expect(trace).toMatchObject({
			runId: "run-1",
			projectId: "p1",
			flowName: "nightly",
			trigger: "manual",
			startedAt: 1000,
			costUsd: 0.25,
			costBasis: "billed",
			ends: [
				{
					seq: 7,
					openedAt: 1000,
					at: 1200,
					status: "finished",
					first: true,
				},
			],
		});
		expect(trace.steps).toEqual([
			{
				id: "s1",
				nodeId: "build",
				nodeType: "agent",
				visit: 1,
				parentStepId: null,
				deviceId: "mac",
				startedAt: 1010,
				ends: [
					{
						seq: 6,
						openedAt: 1010,
						at: 1110,
						outcome: "pass",
						error: null,
						costUsd: null,
						first: true,
					},
				],
				sessions: [
					{
						id: "x1",
						harness: "claude-code",
						model: "claude-sonnet",
						startedAt: 1020,
						endedAt: 1100,
						costUsd: 0.25,
						costBasis: "billed",
						tokens: { input: 900, output: 100, cacheRead: 400, cacheWrite: 0 },
					},
				],
				gateWaits: [],
				sleeps: [],
			},
		]);
	});

	test("lists each end of a reopened step and a resumed run, with where it opened", () => {
		const { events } = log()
			.at(1000, "RunStarted", started)
			.at(1010, "StepStarted", step("ask", "decision"), { stepId: "g" })
			.at(
				1011,
				"GateOpened",
				{ question: "Ship?", choices: [] },
				{ stepId: "g" },
			)
			.at(1100, "StepEnded", ended("stopped"), { stepId: "g" })
			.at(1101, "RunEnded", { status: "stopped", reason: "Stopped" })
			.at(2000, "RunResumed", { nodeId: "ask", stepId: null, prompt: null })
			.at(2001, "StepReopened", { prompt: null }, { stepId: "g" })
			.at(2500, "StepEnded", ended("yes"), { stepId: "g" })
			.at(2600, "RunEnded", { status: "finished", reason: null });

		const trace = runTrace(events);
		expect(
			trace?.ends.map(({ openedAt, at, first }) => ({ openedAt, at, first })),
		).toEqual([
			{ openedAt: 1000, at: 1101, first: true },
			{ openedAt: 2000, at: 2600, first: false },
		]);
		const gate = trace?.steps[0];
		expect(
			gate?.ends.map(({ seq, openedAt, at, first, outcome }) => ({
				seq,
				openedAt,
				at,
				first,
				outcome,
			})),
		).toEqual([
			{ seq: 4, openedAt: 1010, at: 1100, first: true, outcome: "stopped" },
			{ seq: 8, openedAt: 2001, at: 2500, first: false, outcome: "yes" },
		]);
		expect(gate?.gateWaits).toEqual([{ from: 1011, to: 1100 }]);
	});

	test("names what each sleep waited for, and the Call step a step ran in", () => {
		const { events } = log()
			.at(1000, "RunStarted", started)
			.at(1010, "StepStarted", step("each", "call"), { stepId: "c" })
			.at(
				1020,
				"StepStarted",
				step("pause", "wait", { scope: { parentStepId: "c", itemId: null } }),
				{ stepId: "w" },
			)
			.at(
				1030,
				"WaitStarted",
				{ reason: "duration", until: 1500, message: "m", since: 1030 },
				{ stepId: "w" },
			)
			.at(1500, "WaitEnded", { early: false }, { stepId: "w" })
			.at(1510, "StepEnded", ended("done"), { stepId: "w" });

		const trace = runTrace(events);
		const wait = trace?.steps.find((s) => s.id === "w");
		expect(wait?.parentStepId).toBe("c");
		expect(wait?.sleeps).toEqual([
			{ from: 1030, to: 1500, reason: "duration" },
		]);
		expect(trace?.ends).toEqual([]);
	});
});
