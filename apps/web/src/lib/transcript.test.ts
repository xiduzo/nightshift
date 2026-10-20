import { describe, expect, test } from "bun:test";

import type { StepEvent, TranscriptEntry } from "./api-types";
import { applyEntries, emptyRunTranscript, type ToolItem } from "./transcript";

function toolItem(events: StepEvent[]): ToolItem | undefined {
	const entries: TranscriptEntry[] = events.map((event, seq) => ({
		seq,
		stepId: "step",
		sessionId: "s1",
		at: seq,
		event,
	}));
	const state = applyEntries(emptyRunTranscript, entries);
	return state.steps
		.get("step")
		?.items.find((item): item is ToolItem => item.kind === "tool");
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
