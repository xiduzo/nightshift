import { describe, expect, test } from "bun:test";
import { type ExplanationEvent, flowSchema } from "@nightshift/flows";
import { failingScript, fakeHarness } from "../testing/fake";
import { explainRun, explanationPrompt } from "./explain";
import type { AuthoringRun } from "./tools";

const run: AuthoringRun = {
	id: "r1",
	status: "failed",
	reason: "The step `test` failed.",
	inputs: {},
	flow: flowSchema.parse({
		version: 7,
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
			error: null,
			note: null,
		},
	],
	failedStepId: "s1",
	transcript: ["$ bun test", "1 test failed", "Exit code: 1"],
};

async function explain(
	script: Parameters<typeof fakeHarness>[0],
): Promise<{ events: ExplanationEvent[]; prompt: string | undefined }> {
	const harness = fakeHarness(script);
	const events: ExplanationEvent[] = [];
	for await (const event of explainRun({
		run,
		harness,
		profile: { model: "sonnet" },
		cwd: "/repo",
		signal: new AbortController().signal,
	})) {
		events.push(event);
	}
	return { events, prompt: harness.calls[0]?.prompt };
}

describe("explainRun", () => {
	test("the prompt holds the run and the rules of a plain answer", () => {
		const prompt = explanationPrompt(run);
		expect(prompt).toContain("Status: failed");
		expect(prompt).toContain("1 test failed");
		expect(prompt).toContain("two to four short sentences");
		expect(prompt).toContain("no file paths");
	});

	test("the answer is the report's summary, as plain text", async () => {
		const { events } = await explain({
			steps: [
				{ type: "text", text: "Let me look at the run." },
				{
					type: "report",
					outcome: "",
					summary: "## Why\n\nThe **tests** failed. Try the run again.",
				},
			],
		});
		expect(events.filter((e) => e.type !== "usage")).toEqual([
			{ type: "answer", answer: "Why\n\nThe tests failed. Try the run again." },
			{ type: "done" },
		]);
	});

	test("without a report, the agent's text is the answer", async () => {
		const { events } = await explain({
			steps: [{ type: "text", text: "The tests failed." }],
		});
		expect(events.find((e) => e.type === "answer")).toEqual({
			type: "answer",
			answer: "The tests failed.",
		});
	});

	test("a failed session ends with its error", async () => {
		const { events } = await explain(failingScript("The model is down."));
		expect(events.at(-1)).toEqual({
			type: "error",
			message: "The model is down.",
		});
	});
});
