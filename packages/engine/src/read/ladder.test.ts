import { describe, expect, test } from "bun:test";
import type { FlowNodeType } from "@nightshift/flows";
import type { StepOutcome, StepRung } from "../log";
import { runEvents } from "../testing/run-events";
import { ladderOf, landingsOf, runRungs } from "./ladder";
import { deriveSteps } from "./run-views";

/**
 * Where the work landed: the climbs of a run's steps, the rung each one
 * landed on, and what it cost. Shape-only logs.
 */

type Log = ReturnType<typeof runEvents>;

/** A step of `nodeId` that starts on `rung` and ends with `outcome`. */
function step(
	l: Log,
	stepId: string,
	nodeId: string,
	nodeType: FlowNodeType,
	rung: StepRung | undefined,
	outcome: StepOutcome | null,
	outputs: Record<string, string | number> = {},
	more: {
		costUsd?: number;
		scope?: { parentStepId: string; itemId: string | null };
		visit?: number;
	} = {},
): Log {
	l.stepStarted(stepId, nodeId, more.visit ?? 1, {
		nodeType,
		...(rung ? { rung } : {}),
		...(more.scope ? { scope: more.scope } : {}),
	});
	if (outcome !== null) l.stepEnded(stepId, outcome, outputs, more.costUsd);
	return l;
}

/** A Gate on the step, answered by a person or its deadline. */
function answered(l: Log, stepId: string, by: "person" | "deadline"): Log {
	l.gateOpened(stepId);
	return l.push(
		"Scored",
		{ score: "gate_decision", value: 1, label: "approve", by },
		{ stepId },
	);
}

/** An agent session on the step that cost `usd`. */
function spent(l: Log, stepId: string, sessionId: string, usd: number): Log {
	l.sessionStarted(stepId, sessionId);
	return l.sessionEnded(stepId, sessionId, "finished", usd);
}

const landings = (l: Log) => landingsOf(deriveSteps(l.state()));

describe("landingsOf", () => {
	test("a Decision by rule lands on the rule", () => {
		const l = runEvents().runStarted();
		step(l, "s1", "decide", "decision", { by: "rule", last: true }, "bug");
		expect(landings(l)).toEqual([
			{
				ladder: "choice",
				nodeId: "decide",
				nodeType: "decision",
				via: null,
				scope: null,
				stepId: "s1",
				at: 1002,
				rung: "rule",
				by: "rule",
				tier: null,
				tries: 1,
				cost: { usd: 0, estimated: false, missing: 0, calls: 0 },
				picked: false,
				unsure: false,
			},
		]);
	});

	test("a decider without a cascade lands on the first rung, with what it cost", () => {
		const l = runEvents().runStarted();
		step(
			l,
			"s1",
			"decide",
			"decision",
			{ by: "model", last: true },
			"feature",
			{},
			{ costUsd: 0.01 },
		);
		expect(landings(l)).toMatchObject([
			{
				ladder: "choice",
				rung: "first",
				by: "model",
				tier: null,
				cost: { usd: 0.01, calls: 1 },
				picked: false,
				unsure: false,
			},
		]);
	});

	test("Sonnet, then Opus: the later tier lands, and the cost counts both tries", () => {
		const l = runEvents().runStarted();
		step(l, "s1", "build", "agent", { by: "agent", tier: 0 }, null);
		spent(l, "s1", "x1", 1);
		l.stepEnded("s1", "fail", { tier: "Sonnet", tries: 1 });
		step(l, "s2", "build", "agent", { by: "agent", tier: 1, last: true }, null);
		spent(l, "s2", "x2", 3);
		l.stepEnded("s2", "pass", { tier: "Opus", tries: 2 });
		const ladder = ladderOf(deriveSteps(l.state()));
		expect(ladder.landings).toMatchObject([
			{
				ladder: "work",
				nodeId: "build",
				stepId: "s2",
				rung: "later",
				by: "agent",
				tier: "Opus",
				tries: 2,
				cost: { usd: 4, calls: 2, missing: 0 },
			},
		]);
		expect([...ladder.tries]).toEqual([
			["s1", "first"],
			["s2", "later"],
		]);
	});

	test("a person tier that answers lands on you, with each decider's pick", () => {
		const l = runEvents().runStarted();
		step(
			l,
			"s1",
			"decide",
			"decision",
			{ by: "model", tier: 0 },
			"fail",
			{ tier: "local", tries: 1, pick: "bug", confidence: 0.4 },
			{ costUsd: 0.01 },
		);
		step(
			l,
			"s2",
			"decide",
			"decision",
			{ by: "person", tier: 1, last: true },
			null,
		);
		answered(l, "s2", "person");
		l.stepEnded("s2", "bug", { tier: "person", tries: 2 });
		expect(landings(l)).toMatchObject([
			{
				ladder: "choice",
				stepId: "s2",
				rung: "person",
				by: "person",
				tier: "person",
				tries: 2,
				picked: true,
				unsure: true,
			},
		]);
	});

	test("a try-again at the person tier counts as you, also when the next try holds", () => {
		const l = runEvents().runStarted();
		step(l, "s1", "build", "agent", { by: "agent", tier: 0 }, "fail", {
			tier: "Sonnet",
			tries: 1,
		});
		step(
			l,
			"s2",
			"build",
			"agent",
			{ by: "person", tier: 1, last: true },
			null,
		);
		answered(l, "s2", "person");
		l.stepEnded("s2", "try-again", { tier: "you", tries: 2 });
		step(l, "s3", "build", "agent", { by: "agent", tier: 0 }, "pass", {
			tier: "Sonnet",
			tries: 3,
		});
		expect(landings(l)).toMatchObject([
			{ stepId: "s3", rung: "person", by: "person", tier: "you", tries: 3 },
		]);
	});

	test("a Gate its deadline answered lands on the deadline", () => {
		const l = runEvents().runStarted();
		step(l, "s1", "gate", "decision", { by: "person", last: true }, null);
		answered(l, "s1", "deadline");
		l.stepEnded("s1", "approve");
		expect(landings(l)).toMatchObject([
			{ ladder: "choice", rung: "deadline", by: "person", tier: null },
		]);
	});

	test("the last try that does not hold, with no person, lands on none", () => {
		const l = runEvents().runStarted();
		step(l, "s1", "build", "agent", { by: "agent", last: true }, "fail");
		expect(landings(l)).toMatchObject([
			{ rung: "none", by: "agent", tier: null, tries: 1 },
		]);
	});

	test("a stopped try stays in its climb, and a climb that never finished does not land", () => {
		const l = runEvents().runStarted();
		step(l, "s1", "build", "agent", { by: "agent", tier: 0 }, "stopped", {
			tier: "Sonnet",
			tries: 1,
		});
		step(l, "s2", "build", "agent", { by: "agent", tier: 0 }, "fail", {
			tier: "Sonnet",
			tries: 1,
		});
		step(
			l,
			"s3",
			"build",
			"agent",
			{ by: "agent", tier: 1, last: true },
			"pass",
			{
				tier: "Opus",
				tries: 2,
			},
		);
		step(l, "s4", "review", "agent", { by: "agent", tier: 0 }, "fail", {
			tier: "Sonnet",
			tries: 1,
		});
		const ladder = ladderOf(deriveSteps(l.state()));
		expect(ladder.landings).toMatchObject([
			{ nodeId: "build", stepId: "s3", rung: "later", tries: 3 },
		]);
		expect(ladder.tries.get("s4")).toBe("first");
	});

	test("a node visited in a loop lands once per visit", () => {
		const l = runEvents().runStarted();
		step(l, "s1", "build", "agent", { by: "agent", last: true }, "pass");
		spent(l, "s1", "x1", 1);
		step(
			l,
			"s2",
			"build",
			"agent",
			{ by: "agent", last: true },
			"pass",
			{},
			{
				visit: 2,
			},
		);
		spent(l, "s2", "x2", 2);
		const all = landings(l);
		expect(all.map((each) => [each.stepId, each.rung])).toEqual([
			["s1", "first"],
			["s2", "first"],
		]);
		expect(runRungs(all)).toEqual([
			{
				ladder: "work",
				nodeId: "build",
				rung: "first",
				by: "agent",
				tier: null,
				landed: 2,
				costUsd: 3,
				costEstimated: false,
				costMissing: 0,
			},
		]);
	});

	test("a Subflow's landing costs what its called flow cost, and the called flow's steps land too", () => {
		const l = runEvents().runStarted();
		step(l, "c1", "sub", "call", { by: "flow", last: true }, null);
		const scope = { parentStepId: "c1", itemId: null };
		step(
			l,
			"s1",
			"write",
			"agent",
			{ by: "agent", last: true },
			null,
			{},
			{
				scope,
			},
		);
		spent(l, "s1", "x1", 2);
		l.stepEnded("s1", "pass");
		l.stepEnded("c1", "pass");
		const all = landings(l);
		expect(all.map((each) => [each.nodeId, each.via, each.cost.usd])).toEqual([
			["write", "sub", 2],
			["sub", null, 2],
		]);
		expect(runRungs(all)).toMatchObject([
			{ nodeId: "write", via: "sub" },
			{ nodeId: "sub" },
		]);
		expect(runRungs(all)[1]).not.toHaveProperty("via");
	});

	test("a decider that was not sure enough on a try, then sure: the later tier, unsure", () => {
		const l = runEvents().runStarted();
		step(l, "s1", "decide", "decision", { by: "model", tier: 0 }, "fail", {
			tier: "local",
			tries: 1,
			pick: "bug",
			confidence: 0.55,
		});
		step(
			l,
			"s2",
			"decide",
			"decision",
			{ by: "model", tier: 1, last: true },
			"feature",
			{ tier: "strong", tries: 2, confidence: 0.9 },
		);
		step(l, "s3", "decide", "decision", { by: "model", tier: 0 }, "bug", {
			tier: "local",
			tries: 1,
			confidence: 0.95,
		});
		const all = landings(l);
		expect(all).toMatchObject([
			{ rung: "later", tier: "strong", picked: true, unsure: true },
			{ rung: "first", tier: "local", picked: true, unsure: false },
		]);
		expect(runRungs(all)).toMatchObject([
			{ rung: "later", landed: 1, picked: 1, unsure: 1 },
			{ rung: "first", landed: 1, picked: 1, unsure: 0 },
		]);
	});

	test("a Value by rule, a Command and a Tool are on no ladder", () => {
		const l = runEvents().runStarted();
		step(l, "s1", "pick", "value", undefined, "pass");
		step(l, "s2", "check", "command", undefined, "pass");
		step(l, "s3", "fetch", "tool", undefined, "pass");
		const ladder = ladderOf(deriveSteps(l.state()));
		expect(ladder.landings).toEqual([]);
		expect(ladder.tries.size).toBe(0);
	});

	test("an Ask lands on you on the work ladder", () => {
		const l = runEvents().runStarted();
		step(l, "s1", "plan", "value", { by: "person", last: true }, null);
		answered(l, "s1", "person");
		l.stepEnded("s1", "pass");
		expect(landings(l)).toMatchObject([
			{ ladder: "work", rung: "person", by: "person" },
		]);
	});
});

describe("landingsOf, steps of an older Walker", () => {
	test("reads a cascade from its tier labels: the first label is the first tier", () => {
		const l = runEvents().runStarted();
		step(l, "s1", "build", "agent", undefined, "fail", {
			tier: "Sonnet",
			tries: 1,
		});
		step(l, "s2", "build", "agent", undefined, "pass", {
			tier: "Opus",
			tries: 2,
		});
		const ladder = ladderOf(deriveSteps(l.state()));
		expect(ladder.landings).toMatchObject([
			{ stepId: "s2", rung: "later", by: "agent", tier: "Opus", tries: 2 },
		]);
		expect([...ladder.tries]).toEqual([
			["s1", "first"],
			["s2", "later"],
		]);
	});

	test("a try that does not hold lands when no try of its climb follows", () => {
		const l = runEvents().runStarted();
		step(l, "s1", "build", "agent", undefined, "fail", {
			tier: "Sonnet",
			tries: 1,
		});
		step(l, "s2", "build", "agent", undefined, "fail", {
			tier: "Opus",
			tries: 2,
		});
		step(l, "s3", "build", "agent", undefined, "pass", {
			tier: "Sonnet",
			tries: 1,
		});
		expect(
			landings(l).map((each) => [each.stepId, each.rung, each.tries]),
		).toEqual([
			["s2", "none", 2],
			["s3", "first", 1],
		]);
	});

	test("a cascade step with a Gate is a person's", () => {
		const l = runEvents().runStarted();
		step(l, "s1", "decide", "decision", undefined, "fail", {
			tier: "local",
			tries: 1,
			pick: "bug",
			confidence: 0.3,
		});
		step(l, "s2", "decide", "decision", undefined, null);
		answered(l, "s2", "person");
		l.stepEnded("s2", "bug", { tier: "person", tries: 2 });
		expect(landings(l)).toMatchObject([
			{ rung: "person", tier: "person", unsure: true, tries: 2 },
		]);
	});

	test("a Decision without a cascade: a Gate is you, a cost is a decider, else a rule", () => {
		const l = runEvents().runStarted();
		step(l, "s1", "gate", "decision", undefined, null);
		answered(l, "s1", "person");
		l.stepEnded("s1", "approve");
		step(
			l,
			"s2",
			"triage",
			"decision",
			undefined,
			"bug",
			{},
			{ costUsd: 0.02 },
		);
		step(l, "s3", "route", "decision", undefined, "small");
		expect(
			landings(l).map((each) => [each.nodeId, each.rung, each.by]),
		).toEqual([
			["gate", "person", "person"],
			["triage", "first", "model"],
			["route", "rule", "rule"],
		]);
	});

	test("a Value without a cascade: a cost is a decider, nothing is a rule and no ladder", () => {
		const l = runEvents().runStarted();
		step(l, "s1", "draft", "value", undefined, "pass", {}, { costUsd: 0.01 });
		step(l, "s2", "pick", "value", undefined, "pass");
		expect(
			landings(l).map((each) => [each.nodeId, each.rung, each.by]),
		).toEqual([["draft", "first", "model"]]);
	});
});
