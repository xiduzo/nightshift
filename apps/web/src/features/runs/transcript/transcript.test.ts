import { describe, expect, test } from "bun:test";

import type { TranscriptEntry } from "@nightshift/client";
import {
	applyEntries,
	emptyRunTranscript,
	summarizeToolInput,
} from "./transcript";
import type {
	GateResolvedItem,
	ToolItem,
	TranscriptItem,
} from "./transcript-items";

type StepEvent = TranscriptEntry["event"];

function entriesOf(events: StepEvent[], from = 0): TranscriptEntry[] {
	return events.map((event, at) => ({
		seq: from + at,
		stepId: "step",
		sessionId: "s1",
		at: from + at,
		event,
	}));
}

function itemsOf(entries: TranscriptEntry[][]): TranscriptItem[] {
	const state = entries.reduce(applyEntries, emptyRunTranscript);
	return state.steps.get("step")?.items ?? [];
}

function toolItem(events: StepEvent[]): ToolItem | undefined {
	return itemsOf([entriesOf(events)]).find(
		(item): item is ToolItem => item.kind === "tool",
	);
}

describe("an agent's tool call", () => {
	const call: StepEvent[] = [
		{ type: "tool-start", toolCallId: "c1", name: "Bash" },
		{
			type: "tool-end",
			toolCallId: "c1",
			name: "Bash",
			input: { command: "ls" },
		},
	];

	test("fails when the harness marks its result as an error", () => {
		const item = toolItem([
			...call,
			{
				type: "tool-result",
				toolCallId: "c1",
				content: "No such file",
				isError: true,
			},
		]);
		expect(item).toMatchObject({ result: "No such file", failed: true });
	});

	test("without the mark is done, as in older transcripts", () => {
		const item = toolItem([
			...call,
			{ type: "tool-result", toolCallId: "c1", content: "a.txt" },
		]);
		expect(item?.result).toBe("a.txt");
		expect(item?.failed).toBeUndefined();
	});
});

describe("an answered Gate", () => {
	const opened: StepEvent = {
		type: "gate-open",
		question: "Ready?",
		choices: [{ name: "ready", color: "green" }, { name: "revise" }],
	};
	const answered = (choice: string) =>
		itemsOf([
			entriesOf([opened]),
			entriesOf([{ type: "gate-resolved", choice, note: "" }], 1),
		]).find((item): item is GateResolvedItem => item.kind === "gate-resolved");

	test("shows the colour the Gate gave the choice, from an earlier batch", () => {
		expect(answered("ready")?.color).toBe("green");
	});

	test("without a colour on the choice has none", () => {
		expect(answered("revise")?.color).toBeUndefined();
	});
});

describe("the agent's thinking", () => {
	test("joins its deltas into one thought, from the entry before it to its last delta", () => {
		const items = itemsOf([
			entriesOf([
				{ type: "session", sessionId: "h1" },
				{ type: "thinking", messageId: "r1", delta: "Read " },
				{ type: "thinking", messageId: "r1", delta: "the tests." },
			]),
		]);
		expect(items.find((item) => item.kind === "thinking")).toMatchObject({
			key: "thinking:s1:r1",
			text: "Read the tests.",
			startedAt: 0,
			endedAt: 2,
			done: false,
		});
	});

	test("is over once anything follows it, also in a later batch", () => {
		const state = [
			entriesOf([{ type: "thinking", messageId: "r1", delta: "Hmm." }]),
			entriesOf([{ type: "text", messageId: "m1", delta: "Done." }], 1),
		].reduce(applyEntries, emptyRunTranscript);
		const thought = state.steps
			.get("step")
			?.items.find((item) => item.kind === "thinking");
		expect(thought).toMatchObject({ done: true });
	});
});

describe("a subagent's work", () => {
	const task = {
		subagent_type: "Explore",
		description: "Find the tests",
		prompt: "Find them.",
	};
	const start: StepEvent[] = [
		{ type: "tool-start", toolCallId: "task", name: "Agent" },
		{ type: "tool-end", toolCallId: "task", name: "Agent", input: task },
	];
	const sub = { parentToolCallId: "task" };

	test("goes inside the call that started it, not into the transcript", () => {
		const items = itemsOf([
			entriesOf([
				...start,
				{ type: "thinking", messageId: "r", delta: "Where?", ...sub },
				{ type: "tool-start", toolCallId: "g", name: "Grep", ...sub },
				{
					type: "tool-end",
					toolCallId: "g",
					name: "Grep",
					input: { pattern: "test" },
					...sub,
				},
				{ type: "tool-result", toolCallId: "g", content: "a.test.ts", ...sub },
				{ type: "text", messageId: "m", delta: "In a.test.ts.", ...sub },
				{ type: "tool-result", toolCallId: "task", content: "In a.test.ts." },
			]),
		]);
		expect(items.map((item) => item.kind)).toEqual(["session", "tool"]);
		const call = items[1] as ToolItem;
		expect(call).toMatchObject({ result: "In a.test.ts.", endedAt: 7 });
		expect(call.steps?.map((step) => step.kind)).toEqual([
			"thinking",
			"tool",
			"message",
		]);
		expect(call.steps?.[0]).toMatchObject({ text: "Where?", done: true });
		expect(call.steps?.[1]).toMatchObject({
			name: "Grep",
			input: { pattern: "test" },
			result: "a.test.ts",
		});
		expect(call.lastAt).toBe(6);
	});

	test("without the call it started from, shows in the transcript", () => {
		const items = itemsOf([
			entriesOf([{ type: "text", messageId: "m", delta: "Hi.", ...sub }]),
		]);
		expect(items.map((item) => item.kind)).toEqual(["session", "message"]);
	});
});

describe("a tool call's one-line summary", () => {
	const root = "/work/copies/run-1";

	test("shows a path inside the project relative to it", () => {
		expect(
			summarizeToolInput({ file_path: `${root}/src/a.kt`, content: "" }, root),
		).toBe("src/a.kt");
		expect(summarizeToolInput({ filePath: `${root}/README.md` }, root)).toBe(
			"README.md",
		);
	});

	test("keeps a path outside the project, and a command as it is", () => {
		expect(summarizeToolInput({ file_path: "/etc/hosts" }, root)).toBe(
			"/etc/hosts",
		);
		expect(summarizeToolInput({ command: `ls ${root}` }, root)).toBe(
			`ls ${root}`,
		);
	});

	test("names the pattern of a search of the whole project", () => {
		expect(summarizeToolInput({ pattern: "TODO", path: root }, root)).toBe(
			"TODO",
		);
		expect(
			summarizeToolInput({ pattern: "TODO", path: `${root}/src` }, root),
		).toBe("src");
		expect(summarizeToolInput({ path: root }, root)).toBe(".");
	});
});
