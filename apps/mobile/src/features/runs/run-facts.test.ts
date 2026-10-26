/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { StepSummary } from "@nightshift/client";

import { itemStateLabel, runFacts, runLinks, sizeLabel } from "./run-facts";

const MIN = 60_000;
const NOW = new Date(2026, 9, 23, 10, 0).getTime();

type FactRun = Parameters<typeof runFacts>[0];

function factRun(fields: Partial<FactRun> = {}): FactRun {
	return {
		id: "run_42",
		flowName: "Feature factory",
		branch: "nightshift/run-42",
		device: { id: "d1", name: "Mac mini", thisDevice: true },
		createdAt: NOW - 30 * MIN,
		endedAt: null,
		trigger: { kind: "manual" },
		startedBy: { id: "u1", name: "Sander" },
		costUsd: 0.42,
		costMissing: 0,
		costCalls: 3,
		costEstimated: false,
		...fields,
	} as FactRun;
}

function byLabel(facts: ReturnType<typeof runFacts>) {
	return new Map(facts.map((fact) => [fact.label, fact]));
}

describe("runFacts", () => {
	test("a run on its way: flow, branch, computer, start, duration so far, cost and id", () => {
		const facts = runFacts(factRun(), {
			status: "running",
			steps: 3,
			now: NOW,
		});
		expect(facts.map((fact) => fact.label)).toEqual([
			"Flow",
			"Branch",
			"Computer",
			"Started",
			"Duration",
			"Cost",
			"Run",
		]);
		const fact = byLabel(facts);
		expect(fact.get("Flow")?.value).toBe("Feature factory");
		expect(fact.get("Branch")).toMatchObject({
			value: "nightshift/run-42",
			mono: true,
		});
		expect(fact.get("Computer")?.value).toBe("Mac mini");
		expect(fact.get("Started")).toMatchObject({
			value: "30 min ago",
			sub: "By Sander",
		});
		expect(fact.get("Duration")).toMatchObject({
			value: "30 min",
			sub: "3 steps",
		});
		expect(fact.get("Cost")).toMatchObject({ value: "$0.42" });
		expect(fact.get("Run")).toMatchObject({ value: "run_42", mono: true });
	});

	test("an ended run counts to its end; a scheduled quick run on an unnamed Host", () => {
		const fact = byLabel(
			runFacts(
				factRun({
					flowName: null,
					endedAt: NOW - 18 * MIN,
					trigger: { kind: "schedule", scheduleId: "s1", at: NOW - 30 * MIN },
					device: { id: "d1", name: null, thisDevice: true },
				}),
				{ status: "finished", steps: 1, now: NOW },
			),
		);
		expect(fact.get("Flow")?.value).toBe("Quick run");
		expect(fact.get("Computer")?.value).toBe("Your Host");
		expect(fact.get("Started")?.sub).toBe("By a schedule");
		const hooked = byLabel(
			runFacts(
				factRun({
					trigger: { kind: "webhook", scheduleId: "s1", at: NOW - 30 * MIN },
				}),
				{ status: "running", steps: 1, now: NOW },
			),
		);
		expect(hooked.get("Started")?.sub).toBe("By a webhook");
		expect(fact.get("Duration")).toMatchObject({
			value: "12 min",
			sub: "1 step",
		});
	});

	test("the cost says when it is not complete", () => {
		const cost = (fields: Partial<FactRun>) =>
			byLabel(
				runFacts(factRun(fields), { status: "running", steps: 1, now: NOW }),
			).get("Cost");
		expect(cost({ costMissing: 1 })).toMatchObject({
			value: "$0.42+",
			sub: "A step did not report its cost",
		});
		expect(cost({ costEstimated: true })?.sub).toBe("Part of it is estimated");
		expect(cost({ costUsd: 0, costCalls: 0 })).toMatchObject({
			value: "None yet",
		});
		expect(cost({ costUsd: 0, costCalls: 1, costMissing: 1 })).toMatchObject({
			value: "Not known",
		});
	});

	test("an ended run that cost nothing says None", () => {
		const fact = byLabel(
			runFacts(factRun({ costUsd: 0, costCalls: 0 }), {
				status: "finished",
				steps: 1,
				now: NOW,
			}),
		).get("Cost");
		expect(fact).toMatchObject({ value: "None" });
	});
});

describe("runLinks", () => {
	test("the items with a link, once each, in order", () => {
		const item = (id: string, url: string | null) => ({
			id,
			title: `Item ${id}`,
			url,
			value: null,
			state: "done" as const,
			branch: id === "1" ? "feat/one" : null,
			baseBranch: null,
			startedAt: 0,
			endedAt: 1,
			reason: null,
		});
		const steps = [
			{ items: [item("1", "https://example.com/pull/1"), item("2", null)] },
			{
				items: [
					item("1", "https://example.com/pull/1"),
					item("3", "https://example.com/pull/3"),
				],
			},
		] as Pick<StepSummary, "items">[];
		expect(runLinks(steps)).toEqual([
			{
				id: "1",
				title: "Item 1",
				state: "done",
				branch: "feat/one",
				url: "https://example.com/pull/1",
			},
			{
				id: "3",
				title: "Item 3",
				state: "done",
				branch: null,
				url: "https://example.com/pull/3",
			},
		]);
		expect(itemStateLabel("halted")).toBe("Stopped");
	});
});

describe("sizeLabel", () => {
	test("bytes, KB, MB", () => {
		expect(sizeLabel(512)).toBe("512 B");
		expect(sizeLabel(12 * 1024)).toBe("12 KB");
		expect(sizeLabel(1.4 * 1024 * 1024)).toBe("1.4 MB");
	});
});
