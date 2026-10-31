import { describe, expect, test } from "bun:test";

import type { StepSummary } from "@nightshift/client";
import type { TranscriptItem } from "./transcript-items";
import {
	fence,
	itemToMarkdown,
	transcriptToMarkdown,
} from "./transcript-markdown";

const context = {
	sessions: new Map([["s1", { prompt: "Fix the bug.", number: 1 }]]),
	itemTitles: new Map<string, string>(),
};
const base = { sessionId: "s1", at: 0 };

describe("fence", () => {
	test("is longer than any backtick run in the text", () => {
		expect(fence("a ```b``` c", "md")).toBe("````md\na ```b``` c\n````");
		expect(fence("plain\n")).toBe("```\nplain\n```");
	});
});

describe("itemToMarkdown", () => {
	test("a session shows its number, model and prompt as a quote", () => {
		const item: TranscriptItem = {
			...base,
			key: "1",
			kind: "session",
			model: "opus",
		};
		expect(itemToMarkdown(item, context)).toBe(
			"**Session 1** · opus\n\n> Fix the bug.",
		);
	});

	test("a Lease step says it took the lease, or which run holds it", () => {
		const took: TranscriptItem = {
			...base,
			key: "l1",
			kind: "lease",
			name: "branch:x",
			held: true,
			holderTitle: null,
		};
		expect(itemToMarkdown(took, context)).toBe("**Lease:** took `branch:x`");
		expect(
			itemToMarkdown(
				{ ...took, held: false, holderTitle: "Fix red PRs" },
				context,
			),
		).toBe("**Lease:** `branch:x` is busy. Fix red PRs holds it.");
	});

	test("a thought says how long it took and quotes its text", () => {
		const item: TranscriptItem = {
			...base,
			key: "t",
			kind: "thinking",
			text: "Read the tests.\nThen fix.",
			startedAt: 0,
			endedAt: 12_000,
			done: true,
		};
		expect(itemToMarkdown(item, context)).toBe(
			"**Thought for 12s**\n\n> Read the tests.\n> Then fix.",
		);
	});

	test("a subagent's work follows its call as a quote", () => {
		const item: TranscriptItem = {
			...base,
			key: "a",
			kind: "tool",
			toolCallId: "a",
			name: "Agent",
			hasInput: false,
			steps: [{ ...base, key: "m", kind: "message", text: "Found it." }],
		};
		expect(itemToMarkdown(item, context)).toBe(
			"**Tool** `Agent`\n\n> Found it.",
		);
	});

	test("a tool call keeps its input and cuts a long result", () => {
		const item: TranscriptItem = {
			...base,
			key: "2",
			kind: "tool",
			toolCallId: "t",
			name: "Bash",
			input: { command: "ls" },
			hasInput: true,
			result: "x".repeat(4010),
		};
		const text = itemToMarkdown(item, context);
		expect(text).toStartWith(
			'**Tool** `Bash`\n\n```json\n{\n  "command": "ls"\n}\n```',
		);
		expect(text).toEndWith("… (10 more characters)\n```");
	});

	test("a gate answer quotes the note", () => {
		const item: TranscriptItem = {
			...base,
			key: "3",
			kind: "gate-resolved",
			choice: "revise",
			note: "Add a test.",
		};
		expect(itemToMarkdown(item, context)).toBe(
			"**Answer:** `revise`\n\n> Add a test.",
		);
	});
});

describe("transcriptToMarkdown", () => {
	test("names the step and adds its error", () => {
		const step = {
			nodeId: "publish",
			nodeType: "command",
			visit: 1,
			outcome: "fail",
			error: "The command's output is not valid JSON.",
		} as StepSummary;
		const items: TranscriptItem[] = [
			{
				...base,
				sessionId: null,
				key: "c",
				kind: "command",
				command: "git push",
			},
			{ ...base, sessionId: null, key: "e", kind: "exit", exitCode: 0 },
		];
		expect(transcriptToMarkdown(step, items, context)).toBe(
			[
				"### Step `publish` (command) → `fail`",
				"```sh\n$ git push\n```",
				"_Exit code 0._",
				"**The step failed:** The command's output is not valid JSON.",
			].join("\n\n"),
		);
	});
});
