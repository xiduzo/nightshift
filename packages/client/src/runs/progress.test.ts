import { describe, expect, test } from "bun:test";

import {
	applyAgentMessages,
	currentStep,
	groupRuns,
	hasEnded,
	markdownPreview,
	stepState,
} from "./progress";
import type { RunStatus, TranscriptEntry } from "./types";

const run = (id: string, status: RunStatus, createdAt: number) => ({
	id,
	status,
	createdAt,
});

describe("the runs by group", () => {
	test("puts what runs first, then what waits for you, then what ended", () => {
		const groups = groupRuns([
			run("a", "finished", 1),
			run("b", "waiting", 2),
			run("c", "running", 3),
			run("d", "sleeping", 4),
			run("e", "failed", 5),
			run("f", "stopped", 6),
			run("g", "interrupted", 7),
		]);
		expect(
			groups.map(({ group, runs }) => [group, runs.map((r) => r.id)]),
		).toEqual([
			["running", ["d", "c"]],
			["waiting", ["b"]],
			["ended", ["g", "f", "e", "a"]],
		]);
	});

	test("leaves out a group without runs", () => {
		expect(groupRuns([run("a", "finished", 1)]).map((g) => g.group)).toEqual([
			"ended",
		]);
		expect(groupRuns([])).toEqual([]);
	});

	test("does not change the list it got", () => {
		const runs = [run("a", "finished", 1), run("b", "finished", 2)];
		groupRuns(runs);
		expect(runs.map((r) => r.id)).toEqual(["a", "b"]);
	});

	test("knows which statuses have ended", () => {
		expect(hasEnded("finished")).toBe(true);
		expect(hasEnded("interrupted")).toBe(true);
		expect(hasEnded("sleeping")).toBe(false);
		expect(hasEnded("waiting")).toBe(false);
	});
});

describe("where a step is", () => {
	const gate = { question: "Ship it?", choices: [], openedAt: 1 };

	test("running, waiting at its Gate, failed or done", () => {
		expect(stepState({ endedAt: null, error: null, gate: null })).toBe(
			"running",
		);
		expect(stepState({ endedAt: null, error: null, gate })).toBe("waiting");
		expect(stepState({ endedAt: 5, error: "boom", gate: null })).toBe("failed");
		expect(stepState({ endedAt: 5, error: null, gate })).toBe("done");
	});

	test("the current step is the last one that started and runs", () => {
		const steps = [
			{ id: "a", startedAt: 1, endedAt: 2 },
			{ id: "b", startedAt: 3, endedAt: null },
			{ id: "c", startedAt: 4, endedAt: null },
			{ id: "d", startedAt: 5, endedAt: 6 },
		];
		expect(currentStep(steps)?.id).toBe("c");
		expect(currentStep(steps.filter((s) => s.endedAt !== null))).toBeNull();
	});
});

describe("the latest agent message of each step", () => {
	let seq = 0;
	const text = (stepId: string, messageId: string, delta: string) =>
		({
			seq: ++seq,
			stepId,
			sessionId: null,
			at: seq,
			event: { type: "text", messageId, delta },
		}) as TranscriptEntry;
	const report = (stepId: string, summary: string) =>
		({
			seq: ++seq,
			stepId,
			sessionId: null,
			at: seq,
			event: { type: "report", outcome: "pass", summary },
		}) as TranscriptEntry;
	const other = (stepId: string) =>
		({
			seq: ++seq,
			stepId,
			sessionId: null,
			at: seq,
			event: { type: "tool-start", toolCallId: "t", name: "Read" },
		}) as TranscriptEntry;

	test("adds the deltas of one message together", () => {
		const messages = applyAgentMessages(new Map(), [
			text("build", "m1", "Hello"),
			text("build", "m1", ", world"),
		]);
		expect(messages.get("build")).toEqual({ id: "m1", text: "Hello, world" });
	});

	test("a new message or a report takes the place of the last one", () => {
		let messages = applyAgentMessages(new Map(), [
			text("build", "m1", "First"),
			text("build", "m2", "Second"),
			text("review", "m3", "Looks good"),
		]);
		expect(messages.get("build")?.text).toBe("Second");
		messages = applyAgentMessages(messages, [report("build", "Built it.")]);
		expect(messages.get("build")?.text).toBe("Built it.");
		expect(messages.get("review")?.text).toBe("Looks good");
	});

	test("keeps the same map when no entry is a message", () => {
		const before = applyAgentMessages(new Map(), [text("a", "m", "x")]);
		expect(applyAgentMessages(before, [other("a"), report("a", " ")])).toBe(
			before,
		);
	});

	test("does not change the map it got", () => {
		const before = applyAgentMessages(new Map(), [text("a", "m", "x")]);
		applyAgentMessages(before, [text("a", "m", "y")]);
		expect(before.get("a")?.text).toBe("x");
	});
});

describe("a short preview of Markdown", () => {
	test("drops the marks and keeps the words", () => {
		expect(
			markdownPreview(
				[
					"## Plan",
					"",
					"I read **the tests** and `run.ts`. See [the PR](https://x.test/1).",
					"- first",
					"* second",
					"> quoted _here_",
					"```ts",
					"const a = 1;",
					"```",
				].join("\n"),
			),
		).toBe(
			[
				"Plan",
				"",
				"I read the tests and run.ts. See the PR.",
				"• first",
				"• second",
				"quoted here",
				"const a = 1;",
			].join("\n"),
		);
	});

	test("keeps snake_case and 2 * 3 as they are", () => {
		expect(markdownPreview("set max_steps to 2 * 3")).toBe(
			"set max_steps to 2 * 3",
		);
	});

	test("cuts a long text with an ellipsis", () => {
		const preview = markdownPreview("word ".repeat(100), 20);
		expect(preview.length).toBeLessThanOrEqual(20);
		expect(preview.endsWith("…")).toBe(true);
	});

	test("folds many empty lines into one", () => {
		expect(markdownPreview("a\n\n\n\nb")).toBe("a\n\nb");
	});
});
