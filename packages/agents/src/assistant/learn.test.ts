import { describe, expect, test } from "bun:test";
import type { ValueResult } from "../port";
import { fakeHarness, reportingScript } from "../testing/fake";
import { learnFromRun, learnFromRunPrompt, reportedLearnings } from "./learn";
import type { ModelVia } from "./session";

const EVIDENCE =
	"# The run\n\nThe Gate `approve` was answered: no. Note: never on Fridays.";

/** A model that answers `data` once, and keeps what it was asked. */
function model(answer: ValueResult) {
	const asked: { prompt: string; output: Record<string, unknown> }[] = [];
	const via: ModelVia = {
		kind: "model",
		ask: async ({ prompt, output }) => {
			asked.push({ prompt, output });
			return answer;
		},
	};
	return { via, asked };
}

const signal = new AbortController().signal;

describe("the prompt", () => {
	test("holds the rules of a learning, then the evidence", () => {
		const prompt = learnFromRunPrompt(EVIDENCE);
		expect(prompt).toContain("at most 5");
		expect(prompt).toContain("Never a secret");
		expect(prompt).toContain("An empty list is a good answer");
		expect(prompt.endsWith(EVIDENCE)).toBe(true);
	});
});

describe("reportedLearnings", () => {
	test("keeps strings, trimmed, at most five, each cut", () => {
		const long = "x".repeat(400);
		expect(
			reportedLearnings({
				learnings: [" One\n two ", 3, "", "Three.", "4", "5", long, "7"],
			}),
		).toEqual(["One two", "Three.", "4", "5", `${"x".repeat(299)}…`]);
	});

	test("is empty for data of another shape", () => {
		expect(reportedLearnings(null)).toEqual([]);
		expect(reportedLearnings({ learnings: "One." })).toEqual([]);
	});
});

describe("learnFromRun", () => {
	test("a model gets the prompt and the shape, and its learnings come back with the cost", async () => {
		const { via, asked } = model({
			kind: "made",
			data: {
				summary: "Read the Gate's answer.",
				data: { learnings: ["Release only from Monday to Thursday."] },
			},
			costUsd: 0.002,
		});
		const answer = await learnFromRun({ evidence: EVIDENCE, via, signal });
		expect(answer).toEqual({
			kind: "learned",
			notes: ["Release only from Monday to Thursday."],
			usage: { inputTokens: 0, outputTokens: 0, costUsd: 0.002 },
		});
		expect(asked[0]?.prompt).toContain("never on Fridays");
		expect(JSON.stringify(asked[0]?.output)).toContain('"learnings"');
	});

	test("an empty list is an answer: nothing to learn", async () => {
		const { via } = model({
			kind: "made",
			data: { summary: "Nothing new.", data: { learnings: [] } },
			costUsd: null,
		});
		expect(await learnFromRun({ evidence: EVIDENCE, via, signal })).toEqual({
			kind: "learned",
			notes: [],
			usage: null,
		});
	});

	test("a model that fails gives an error, never a throw", async () => {
		const via: ModelVia = {
			kind: "model",
			ask: async () => {
				throw new Error("No key.");
			},
		};
		const answer = await learnFromRun({ evidence: EVIDENCE, via, signal });
		expect(answer).toMatchObject({ kind: "error", message: "No key." });
	});

	test("an agent answers in a read-only session with a report", async () => {
		const harness = fakeHarness(
			reportingScript("pass", "Read the run.", {
				learnings: ["Run the migrations first."],
			}),
		);
		const answer = await learnFromRun({
			evidence: EVIDENCE,
			via: {
				kind: "agent",
				harness,
				profile: { model: "haiku" },
				cwd: "/own",
				limits: { turns: 10, usd: 0.25 },
			},
			signal,
		});
		expect(answer).toMatchObject({
			kind: "learned",
			notes: ["Run the migrations first."],
		});
		expect(harness.calls[0]).toMatchObject({
			readOnly: true,
			cwd: "/own",
			maxTurns: 10,
			maxBudgetUsd: 0.25,
		});
		expect(harness.calls[0]?.tools).toBeUndefined();
	});
});
