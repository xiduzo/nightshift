import { describe, expect, test } from "bun:test";

import type { StepEvent, TranscriptEntry } from "@/shared/api/contract";
import { applyEntries, emptyRunTranscript } from "./transcript";
import type {
	GateResolvedItem,
	ToolItem,
	TranscriptItem,
} from "./transcript-items";

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
