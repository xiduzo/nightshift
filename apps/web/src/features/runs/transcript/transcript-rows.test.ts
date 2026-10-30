import { describe, expect, test } from "bun:test";

import type { TranscriptItem } from "./transcript-items";
import {
	rowItems,
	type TranscriptRow,
	transcriptRows,
} from "./transcript-rows";

const base = { sessionId: "s1", at: 0 };

function keysOf(row: TranscriptRow | undefined): string[] {
	return row ? rowItems(row).map((item) => item.key) : [];
}

function message(key: string): TranscriptItem {
	return { ...base, kind: "message", key, text: key };
}

function tool(key: string, name = "Bash"): TranscriptItem {
	return {
		...base,
		kind: "tool",
		key,
		toolCallId: key,
		name,
		hasInput: false,
	};
}

describe("transcriptRows", () => {
	test("folds tool calls in a row, a single call stays a row", () => {
		const items = [
			message("m1"),
			tool("t1"),
			tool("t2", "Read"),
			tool("t3", "Edit"),
			message("m2"),
			tool("t4"),
		];
		const rows = transcriptRows(items, { groupTools: true });
		expect(rows.map((row) => row.kind)).toEqual([
			"item",
			"tool-calls",
			"item",
			"item",
		]);
		expect(keysOf(rows[1])).toEqual(["t1", "t2", "t3"]);
	});

	test("without grouping every call is its own row", () => {
		const items = [tool("t1"), tool("t2")];
		const rows = transcriptRows(items, { groupTools: false });
		expect(rows.map((row) => row.kind)).toEqual(["item", "item"]);
	});

	test("a command takes its log and its exit", () => {
		const items: TranscriptItem[] = [
			{ ...base, sessionId: null, kind: "command", key: "c", command: "ls" },
			{
				...base,
				sessionId: null,
				kind: "log",
				key: "l",
				chunks: [{ stream: "stdout", text: "a\n" }],
			},
			{ ...base, sessionId: null, kind: "exit", key: "e", exitCode: 0 },
		];
		const rows = transcriptRows(items, { groupTools: true });
		expect(rows).toHaveLength(1);
		expect(rows[0]?.kind).toBe("command");
		expect(keysOf(rows[0])).toEqual(["c", "l", "e"]);
	});

	test("a command that still runs has no log or exit yet", () => {
		const items: TranscriptItem[] = [
			{ ...base, sessionId: null, kind: "command", key: "c", command: "ls" },
		];
		const rows = transcriptRows(items, { groupTools: true });
		expect(keysOf(rows[0])).toEqual(["c"]);
	});
});
