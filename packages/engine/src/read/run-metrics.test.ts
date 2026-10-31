import { describe, expect, test } from "bun:test";
import { type EnginePayloads, foldRun, NO_COST } from "../log";
import { runEvents as log } from "../testing/run-events";
import { runFacts } from "./read-model";
import {
	costBasis,
	pullRequestOf,
	runMetrics,
	stepMetrics,
} from "./run-metrics";
import { deriveSteps, sumCost } from "./run-views";

/** A finished session's usage and cost, unless `extra` says otherwise. */
const spent = (
	extra: Partial<EnginePayloads["SessionEnded"]> = {},
): Partial<EnginePayloads["SessionEnded"]> => ({
	usage: {
		inputTokens: 1000,
		outputTokens: 200,
		cacheReadTokens: 600,
		cacheWriteTokens: 100,
	},
	costSource: "reported",
	...extra,
});

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
			.at(0)
			.runStarted()
			.at(10)
			.stepStarted("s1", "a")
			.at(20)
			.sessionStarted("s1", "x1")
			.at(120)
			.sessionEnded("s1", "x1", "finished", 0.5, spent())
			.at(130)
			.gateOpened("s1")
			.at(530)
			.push("StepReopened", { prompt: "go on" }, { stepId: "s1" })
			.at(540)
			.sessionStarted("s1", "x2")
			.at(640)
			.sessionEnded(
				"s1",
				"x2",
				"finished",
				0.5,
				spent({ costSource: "estimated" }),
			)
			.at(650)
			.stepEnded("s1", "pass", { data: { url: PR } });
		const [step] = deriveSteps(l.state());
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
			.at(0)
			.runStarted()
			.at(10)
			.stepStarted("s1", "a")
			.at(20)
			.sessionStarted("s1", "x1")
			.at(80)
			.push(
				"SessionUsage",
				{
					usage: { inputTokens: 50, outputTokens: 5 },
					costUsd: null,
				},
				{ stepId: "s1", sessionId: "x1" },
			);
		const [step] = deriveSteps(l.state());
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
		const l = log()
			.at(0)
			.runStarted()
			.at(10)
			.stepStarted("s1", "a")
			.at(20)
			.gateOpened("s1");
		const [step] = deriveSteps(l.state());
		if (!step) throw new Error("no step");
		expect(stepMetrics(step).gateWaitMs).toBe(0);
	});

	test("ends a Gate's wait when the run stops", () => {
		const l = log()
			.at(0)
			.runStarted()
			.at(10)
			.stepStarted("s1", "a")
			.at(20)
			.gateOpened("s1")
			.at(70)
			.push("RunEnded", { status: "stopped", reason: null });
		const [step] = deriveSteps(l.state());
		if (!step) throw new Error("no step");
		expect(stepMetrics(step).gateWaitMs).toBe(50);
	});
});

describe("runMetrics", () => {
	const night = () =>
		log()
			.at(1000)
			.runStarted()
			.at(1010)
			.stepStarted("s1", "a")
			.at(1020)
			.sessionStarted("s1", "x1")
			.at(1100)
			.sessionEnded("s1", "x1", "finished", 0.5, spent())
			.at(1110)
			.stepEnded("s1", "pass", { data: { url: PR } })
			.at(1120)
			.stepStarted("s2", "a", 2)
			.at(1130)
			.sessionStarted("s2", "x2")
			.at(1200)
			.sessionEnded(
				"s2",
				"x2",
				"finished",
				0.5,
				spent({ costUsd: null, usage: null }),
			)
			.at(1210)
			.stepEnded("s2", "pass", {
				log_tail: "https://github.com/acme/app/pull/8",
			})
			.at(1300)
			.ended("finished");

	test("adds up every step, takes the last pull request, and the run's wall time", () => {
		const { events } = night();
		const run = foldRun(events);
		expect(runMetrics(deriveSteps(run), sumCost(run), 1000, 1300)).toEqual({
			wallMs: 300,
			agentMs: 150,
			gateWaitMs: 0,
			tokens: { input: 1000, output: 200, cacheRead: 600, cacheWrite: 100 },
			costBasis: "unknown",
			prUrl: "https://github.com/acme/app/pull/8",
			scores: [],
		});
	});

	test("has no wall time while the run is open", () => {
		const { events } = log()
			.at(1000)
			.runStarted()
			.at(1010)
			.stepStarted("s1", "a");
		expect(
			runMetrics(deriveSteps(foldRun(events)), NO_COST, 1000, null).wallMs,
		).toBe(null);
	});

	test("rides on the run's facts, as the run list reads them", () => {
		const facts = runFacts(night().state());
		expect(facts.metrics.wallMs).toBe(300);
		expect(facts.metrics.prUrl).toBe("https://github.com/acme/app/pull/8");
		expect(facts.costMissing).toBe(1);
	});

	test("lists the run's scores, oldest first", () => {
		const { events } = night()
			.at(1400)
			.push(
				"Scored",
				{ score: "gate_decision", value: 1, label: "approve", by: "person" },
				{ stepId: "s2" },
			);
		expect(runFacts(foldRun(events)).metrics.scores).toEqual([
			{
				score: "gate_decision",
				value: 1,
				label: "approve",
				stepId: "s2",
				at: 1400,
				by: "person",
			},
		]);
	});
});

describe("the knowledge agents used", () => {
	const hit = {
		path: "wiki/deploy.md",
		section: "Deploy",
		line: 3,
		page: null,
		found: ["words" as const],
	};
	test("each step keeps its searches and reads in order, and the metrics count them", () => {
		const { events } = log()
			.runStarted()
			.stepStarted("s1", "worker")
			.sessionStarted("s1", "a")
			.push(
				"KnowledgeSearched",
				{ projectId: "p", query: "deploy", hits: [hit], via: "step" },
				{ stepId: "s1", sessionId: "a" },
			)
			.push(
				"KnowledgeRead",
				{ projectId: "p", path: "wiki/deploy.md", found: true, via: "step" },
				{ stepId: "s1", sessionId: "a" },
			)
			.sessionEnded("s1", "a", "finished", 0.1)
			.stepEnded("s1")
			.stepStarted("s2", "worker", 2)
			.push(
				"KnowledgeSearched",
				{ projectId: "p", query: "nothing", hits: [], via: "step" },
				{ stepId: "s2" },
			)
			.stepEnded("s2");
		const run = foldRun(events);
		const [s1, s2] = deriveSteps(run);
		expect(s1?.knowledge.map((use) => [use.type, use.seq])).toEqual([
			["KnowledgeSearched", 4],
			["KnowledgeRead", 5],
		]);
		expect(s1?.knowledge[0]?.payload).toEqual({
			projectId: "p",
			query: "deploy",
			hits: [hit],
			via: "step",
		});
		expect(stepMetrics(s1 as never).knowledge).toEqual({
			searches: 1,
			reads: 1,
		});
		expect(stepMetrics(s2 as never).knowledge).toEqual({
			searches: 1,
			reads: 0,
		});
		expect(
			runMetrics(deriveSteps(run), sumCost(run), 1000, 2000).knowledge,
		).toEqual({ searches: 2, reads: 1 });
	});
});
