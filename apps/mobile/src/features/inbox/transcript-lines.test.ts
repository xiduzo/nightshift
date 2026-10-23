/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { TranscriptEntry } from "@nightshift/client";

import { MAX_LINES, transcriptLines } from "./transcript-lines";

let seq = 0;
function entry(
	stepId: string,
	event: Record<string, unknown> & { type: string },
): TranscriptEntry {
	seq += 1;
	return { seq, stepId, sessionId: null, at: seq, event } as TranscriptEntry;
}

const label = (stepId: string) => (stepId === "s1" ? "Build" : "Review");

describe("transcriptLines", () => {
	test("opens each step with its name and joins an agent's message", () => {
		const lines = transcriptLines(
			[
				entry("s1", { type: "text", messageId: "m1", delta: "Hello " }),
				entry("s1", { type: "text", messageId: "m1", delta: "**there**" }),
				entry("s1", { type: "report", outcome: "pass", summary: "Done." }),
				entry("s2", {
					type: "gate-open",
					question: "Ship it?\n\nMore text",
					choices: [],
				}),
				entry("s2", { type: "gate-resolved", choice: "approve", note: "" }),
			],
			label,
		);
		expect(lines.map((line) => [line.kind, line.text])).toEqual([
			["step", "Build"],
			["agent", "Hello there"],
			["agent", "Done."],
			["step", "Review"],
			["night-shift", "Asks: Ship it?"],
			["night-shift", "Answered approve."],
		]);
	});

	test("a command, its output in one line, and how it ended", () => {
		const lines = transcriptLines(
			[
				entry("s1", { type: "command-start", command: "bun test" }),
				entry("s1", {
					type: "command-output",
					stream: "stdout",
					text: "1 pass\n",
				}),
				entry("s1", {
					type: "command-output",
					stream: "stderr",
					text: "1 fail\n",
				}),
				entry("s1", { type: "command-exit", exitCode: 1 }),
			],
			label,
		);
		expect(lines.map((line) => [line.kind, line.text])).toEqual([
			["step", "Build"],
			["command", "bun test"],
			["output", "1 pass\n1 fail\n"],
			["night-shift", "The command failed."],
		]);
	});

	test("leaves out events with nothing to read, and a step with no lines", () => {
		const lines = transcriptLines(
			[
				entry("s1", { type: "session", sessionId: "x" }),
				entry("s1", { type: "tool-start", toolCallId: "t", name: "Read" }),
				entry("s2", {
					type: "decision",
					label: "approve",
					notes: "Looks fine",
				}),
			],
			label,
		);
		expect(lines.map((line) => [line.kind, line.text])).toEqual([
			["step", "Review"],
			["night-shift", "Chose approve. Looks fine"],
		]);
	});

	test("keeps only the newest lines", () => {
		const many = Array.from({ length: MAX_LINES + 20 }, (_, index) =>
			entry("s1", { type: "error", kind: "harness", message: `Line ${index}` }),
		);
		const lines = transcriptLines(many, label);
		expect(lines).toHaveLength(MAX_LINES);
		expect(lines.at(-1)?.text).toBe(`Line ${MAX_LINES + 19}`);
	});
});
