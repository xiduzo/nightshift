import { describe, expect, test } from "bun:test";
import {
	LEARN_OUTPUT,
	learnFromRunPrompt,
	reportedLearnings,
} from "../catalog";
import type { AssistantVia } from "../sessions";
import { inMemorySessions } from "../sessions/adapters/out/in-memory-sessions";
import { learnFromRun } from "./learn-from-run";

const EVIDENCE =
	"# The run\n\nThe Gate `approve` was answered: no. Note: never on Fridays.";
const signal = new AbortController().signal;
const via: AssistantVia = {
	kind: "model",
	ask: async () => ({ kind: "made", data: null, costUsd: null }),
};
const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0.002 };
const end = (data: unknown) =>
	({
		type: "end",
		sessionId: "",
		report: { summary: "Read it.", data },
		text: "",
	}) as const;

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
	test("asks once with the evidence and the shape, and gives the learnings with the cost", async () => {
		const sessions = inMemorySessions([
			{ type: "usage", usage },
			end({ learnings: ["Release only from Monday to Thursday."] }),
		]);
		expect(
			await learnFromRun(sessions)({ evidence: EVIDENCE, via, signal }),
		).toEqual({
			kind: "learned",
			notes: ["Release only from Monday to Thursday."],
			usage,
		});
		expect(sessions.asked).toEqual([
			{
				prompt: learnFromRunPrompt(EVIDENCE),
				report: { output: LEARN_OUTPUT },
				signal,
			},
		]);
	});

	test("an empty list is an answer: nothing to learn", async () => {
		const sessions = inMemorySessions([end({ learnings: [] })]);
		expect(
			await learnFromRun(sessions)({ evidence: EVIDENCE, via, signal }),
		).toEqual({ kind: "learned", notes: [], usage: null });
	});

	test("a failure gives an error with what it cost so far", async () => {
		const failed = inMemorySessions([
			{ type: "usage", usage },
			{ type: "error", message: "No key.", sessionId: null },
		]);
		expect(
			await learnFromRun(failed)({ evidence: EVIDENCE, via, signal }),
		).toEqual({ kind: "error", message: "No key.", usage });
		expect(
			await learnFromRun(inMemorySessions([]))({
				evidence: EVIDENCE,
				via,
				signal,
			}),
		).toEqual({
			kind: "error",
			message: "The Learner gave no answer.",
			usage: null,
		});
	});
});
