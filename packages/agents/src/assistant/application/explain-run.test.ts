import { describe, expect, test } from "bun:test";
import {
	type ExplanationEvent,
	FLOW_VERSION,
	flowSchema,
} from "@nightshift/flows";
import type { AuthoringRun } from "../domain/authoring";
import type { AssistantVia } from "../sessions";
import { inMemorySessions } from "../sessions/adapters/out/in-memory-sessions";
import { explainRun } from "./explain-run";

const run: AuthoringRun = {
	id: "r1",
	status: "failed",
	reason: "The step `test` failed.",
	inputs: {},
	flow: flowSchema.parse({
		version: FLOW_VERSION,
		inputs: [],
		start: "test",
		nodes: [
			{
				id: "test",
				type: "command",
				label: "Run the tests",
				position: { x: 0, y: 0 },
				command: "bun test",
			},
		],
		edges: [],
	}),
	steps: [
		{
			id: "s1",
			flow: null,
			nodeId: "test",
			nodeType: "command",
			visit: 1,
			outcome: "fail",
			error: "The command failed.",
			note: "Ran on the second try.",
		},
	],
	failedStepId: "s1",
	transcript: ["$ bun test", "1 test failed", "Exit code: 1"],
};

const via: AssistantVia = {
	kind: "model",
	ask: async () => ({ kind: "made", data: null, costUsd: null }),
};

async function explain(...script: Parameters<typeof inMemorySessions>[0]) {
	const sessions = inMemorySessions(script);
	const events: ExplanationEvent[] = [];
	for await (const event of explainRun(sessions)({
		run,
		via,
		signal: new AbortController().signal,
	})) {
		events.push(event);
	}
	return { events, asked: sessions.asked };
}

const end = (summary: string | null, text = "") =>
	({
		type: "end",
		sessionId: "s",
		report: summary === null ? null : { summary },
		text,
	}) as const;

describe("explainRun", () => {
	test("the prompt holds the rules of a plain answer, the run, its failed step and transcript", async () => {
		const { asked } = await explain(end("Why."));
		expect(asked).toHaveLength(1);
		expect(asked[0]?.report).toEqual({});
		const prompt = asked[0]?.prompt ?? "";
		expect(prompt).toContain("two to four short sentences");
		expect(prompt).toContain("no file paths");
		expect(prompt).toContain("Status: failed");
		expect(prompt).toContain("The command failed.");
		expect(prompt).toContain("Ran on the second try.");
		expect(prompt).toContain("1 test failed");
		expect(prompt).not.toContain("undefined");
	});

	test("streams the activity and the cost, then the report's summary as plain text", async () => {
		const usage = { inputTokens: 1, outputTokens: 1 };
		const { events } = await explain(
			{ type: "session", sessionId: "s" },
			{ type: "text", delta: "Let me look." },
			{ type: "activity", text: "Reads a file" },
			{ type: "usage", usage },
			end("## Why\n\nThe **tests** failed. Try the run again.", "Let me look."),
		);
		expect(events).toEqual([
			{ type: "activity", text: "Reads a file" },
			{ type: "usage", usage },
			{ type: "answer", answer: "Why\n\nThe tests failed. Try the run again." },
			{ type: "done" },
		]);
	});

	test("without a report, the agent's text is the answer", async () => {
		const { events } = await explain(end(null, "The tests failed."));
		expect(events[0]).toEqual({ type: "answer", answer: "The tests failed." });
	});

	test("a long answer is cut", async () => {
		const { events } = await explain(end("x".repeat(2_000)));
		expect(events[0]).toEqual({
			type: "answer",
			answer: `${"x".repeat(1_199)}…`,
		});
	});

	test("no answer, or a failed session, ends with an error", async () => {
		expect((await explain(end(""))).events).toEqual([
			{
				type: "error",
				message: "The agent stopped without an answer. Ask again.",
			},
		]);
		expect(
			(
				await explain({
					type: "error",
					message: "The model is down.",
					sessionId: null,
				})
			).events,
		).toEqual([{ type: "error", message: "The model is down." }]);
	});
});
