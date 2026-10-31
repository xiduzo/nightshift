import { describe, expect, test } from "bun:test";
import { type EnginePayloads, foldRun } from "../log";
import { runEvents as log } from "../testing/run-events";
import { runTrace } from "./run-trace";
import { sumCost } from "./run-views";

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
		expect(runTrace(foldRun([]))).toBeNull();
	});

	test("gives each step its ends, sessions with harness, model, tokens and cost", () => {
		const { events } = log()
			.at(1000)
			.push("RunStarted", started)
			.at(1010)
			.push("StepStarted", step("build", "agent"), { stepId: "s1" })
			.at(1020)
			.push(
				"SessionStarted",
				{ prompt: "p", resumeSessionId: null, harness: "claude-code" },
				{ stepId: "s1", sessionId: "x1" },
			)
			.at(1021)
			.push(
				"HarnessSessionAssigned",
				{ harnessSessionId: "h1", model: "claude-sonnet" },
				{ stepId: "s1", sessionId: "x1" },
			)
			.at(1100)
			.push(
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
			.at(1110)
			.push("StepEnded", ended("pass"), { stepId: "s1" })
			.at(1200)
			.push("RunEnded", { status: "finished", reason: null });

		const trace = runTrace(foldRun(events));
		expect(trace).not.toBeNull();
		if (!trace) return;
		expect(trace).toMatchObject({
			runId: "run-1",
			projectId: "p1",
			flowName: "nightly",
			trigger: "manual",
			startedAt: 1000,
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
						costBasis: "billed",
						first: true,
						sessions: [
							{
								id: "x1",
								harness: "claude-code",
								model: "claude-sonnet",
								startedAt: 1020,
								endedAt: 1100,
								costUsd: 0.25,
								costBasis: "billed",
								tokens: {
									input: 900,
									output: 100,
									cacheRead: 400,
									cacheWrite: 0,
								},
							},
						],
						gateWaits: [],
						sleeps: [],
					},
				],
			},
		]);
	});

	test("an end's parts cost what the Spend tab counts: a session cut short, a decider's estimate", () => {
		const b = log()
			.runStarted()
			.stepStarted("s1", "build")
			.sessionStarted("s1", "x1")
			.push(
				"SessionUsage",
				{
					usage: { inputTokens: 10, outputTokens: 5 },
					costUsd: 0.4,
					costSource: "estimated",
				},
				{ stepId: "s1", sessionId: "x1" },
			)
			// Night Shift stopped: the step ends, the session never says it did.
			.stepEnded("s1", "interrupted")
			.stepStarted("d1", "decide")
			.push(
				"StepEnded",
				{
					outcome: "yes",
					outputs: {},
					error: null,
					costUsd: 0.02,
					costSource: "estimated",
				},
				{ stepId: "d1" },
			)
			.ended("interrupted");
		const trace = runTrace(b.state());
		const [build, decide] = trace?.steps ?? [];
		expect(build?.ends[0]?.sessions).toMatchObject([
			{ id: "x1", endedAt: null, costUsd: 0.4, costBasis: "estimated" },
		]);
		expect(decide?.ends[0]).toMatchObject({
			costUsd: 0.02,
			costBasis: "estimated",
		});
		const parts = (trace?.steps ?? []).flatMap((s) => s.ends);
		const exported = parts.reduce(
			(usd, end) =>
				usd +
				(end.costUsd ?? 0) +
				end.sessions.reduce((n, x) => n + (x.costUsd ?? 0), 0),
			0,
		);
		expect(exported).toBeCloseTo(sumCost(b.state()).usd);
	});

	test("lists each end of a reopened step and a resumed run, with where it opened", () => {
		const { events } = log()
			.at(1000)
			.push("RunStarted", started)
			.at(1010)
			.push("StepStarted", step("ask", "decision"), { stepId: "g" })
			.at(1011)
			.push("GateOpened", { question: "Ship?", choices: [] }, { stepId: "g" })
			.at(1100)
			.push("StepEnded", ended("stopped"), { stepId: "g" })
			.at(1101)
			.push("RunEnded", { status: "stopped", reason: "Stopped" })
			.at(2000)
			.push("RunResumed", { nodeId: "ask", stepId: null, prompt: null })
			.at(2001)
			.push("StepReopened", { prompt: null }, { stepId: "g" })
			.at(2500)
			.push("StepEnded", ended("yes"), { stepId: "g" })
			.at(2600)
			.push("RunEnded", { status: "finished", reason: null });

		const trace = runTrace(foldRun(events));
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
		// The wait belongs to the part it began in.
		expect(gate?.ends.map((end) => end.gateWaits)).toEqual([
			[{ from: 1011, to: 1100 }],
			[],
		]);
	});

	test("names what each sleep waited for, and the Call step a step ran in", () => {
		const { events } = log()
			.at(1000)
			.push("RunStarted", started)
			.at(1010)
			.push("StepStarted", step("each", "call"), { stepId: "c" })
			.at(1020)
			.push(
				"StepStarted",
				step("pause", "wait", { scope: { parentStepId: "c", itemId: null } }),
				{ stepId: "w" },
			)
			.at(1030)
			.push(
				"WaitStarted",
				{ reason: "duration", until: 1500, message: "m", since: 1030 },
				{ stepId: "w" },
			)
			.at(1500)
			.push("WaitEnded", { early: false }, { stepId: "w" })
			.at(1510)
			.push("StepEnded", ended("done"), { stepId: "w" });

		const trace = runTrace(foldRun(events));
		const wait = trace?.steps.find((s) => s.id === "w");
		expect(wait?.parentStepId).toBe("c");
		expect(wait?.ends[0]?.sleeps).toEqual([
			{ from: 1030, to: 1500, reason: "duration" },
		]);
		expect(trace?.ends).toEqual([]);
	});
});
