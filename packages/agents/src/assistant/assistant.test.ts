import { describe, expect, test } from "bun:test";
import {
	FLOW_VERSION,
	flowSchema,
	suggestionRequestSchema,
} from "@nightshift/flows";
import { fakeHarness, reportingScript } from "../testing";
import { wireAssistant } from ".";

/**
 * The assistant as production wires it, over a fake harness: the use cases
 * reach the harness through the real sessions. What each one decides is in
 * the tests of `application/`.
 */
const assistant = wireAssistant();
const signal = new AbortController().signal;
const flow = flowSchema.parse({
	version: FLOW_VERSION,
	start: "plan",
	nodes: [
		{
			id: "plan",
			type: "command",
			position: { x: 0, y: 0 },
			command: "cat plan.md",
		},
	],
	edges: [],
});
const via = (harness: ReturnType<typeof fakeHarness>) => ({
	kind: "agent" as const,
	harness,
	profile: { model: "m" },
	cwd: "/repo",
	limits: { turns: 10, usd: 0.25 },
});
const limited = {
	cwd: "/repo",
	readOnly: true,
	stepReport: { outcome: false },
	maxTurns: 10,
	maxBudgetUsd: 0.25,
};

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const event of stream) out.push(event);
	return out;
}

describe("wireAssistant", () => {
	test("suggestField reports through a read-only session, with the lines and the cost", async () => {
		const harness = fakeHarness({
			steps: [
				{ type: "tool", name: "Read", input: { file_path: "/repo/plan.md" } },
				{
					type: "report",
					outcome: "",
					summary: "A note.",
					data: { command: "ls" },
				},
			],
			outcome: {
				type: "finished",
				usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.01 },
			},
			delayMs: 0,
		});
		const events = await collect(
			assistant.suggestField({
				request: suggestionRequestSchema.parse({
					projectId: "p1",
					flowName: "fix",
					flow,
					nodeId: "plan",
					kind: "command",
					instruction: "List the files.",
				}),
				via: via(harness),
				place: {},
				signal,
			}),
		);
		expect(events.slice(0, 2)).toEqual([
			{ type: "activity", text: "Reads plan.md" },
			{
				type: "usage",
				usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.01 },
			},
		]);
		expect(events.at(-1)).toEqual({ type: "done" });
		expect(harness.calls[0]).toMatchObject(limited);
	});

	test("explainRun, learnFromRun and checkAgent answer from the harness", async () => {
		const explains = fakeHarness(reportingScript("pass", "It failed."));
		expect(
			await collect(
				assistant.explainRun({
					run: {
						id: "r1",
						status: "failed",
						reason: null,
						inputs: {},
						flow,
						steps: [],
						failedStepId: null,
						transcript: [],
					},
					via: via(explains),
					signal,
				}),
			),
		).toContainEqual({ type: "answer", answer: "It failed." });
		expect(explains.calls[0]).toMatchObject(limited);

		const learns = fakeHarness(
			reportingScript("pass", "Read it.", { learnings: ["Migrate first."] }),
		);
		expect(
			await assistant.learnFromRun({
				evidence: "The run",
				via: via(learns),
				signal,
			}),
		).toMatchObject({ kind: "learned", notes: ["Migrate first."] });
		expect(learns.calls[0]?.tools).toBeUndefined();

		const checked = fakeHarness({
			steps: [{ type: "text", text: "Ready." }],
			delayMs: 0,
		});
		const { profile, cwd } = via(checked);
		expect(
			await assistant.checkAgent({ harness: checked, profile, cwd, signal }),
		).toEqual({ answered: true });
		expect(checked.calls[0]).toMatchObject({ readOnly: true, maxTurns: 2 });
	});
});
