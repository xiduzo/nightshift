import { describe, expect, test } from "bun:test";
import { parseInstant } from "@nightshift/time";
import {
	formatLearnings,
	formatPersonNote,
	learningNotes,
	learningPreface,
	parseLearnings,
	withoutNote,
} from "./learning-file";

/** The text of a proposed learning's file: what is written reads back the same. */

/** What makes a note hard: whitespace, and text that looks like the format itself. */
const NOTES = [
	"Use bun.",
	"  Tests  run\n with\tbun test.\r\n",
	"- Starts with a dash.",
	"# Looks like a title",
	"What the agents of run x proposed to learn about this project.",
	'Quotes " and \\ stay.',
	" Odd spaces ",
];

describe("the notes of a file", () => {
	test("are each on one line and trimmed, the empty ones left out", () => {
		expect(learningNotes(["  One\n two ", "", " \t\n", "Three."])).toEqual([
			"One two",
			"Three.",
		]);
	});

	test("read back as they were kept, for any note", () => {
		const text = formatLearnings(NOTES, { runId: "run-1", isNew: true });
		expect(parseLearnings(text)).toEqual(learningNotes(NOTES));
	});

	test("read back the same when a step adds to its file", () => {
		const first = formatLearnings(["One."], { runId: "run-1", isNew: true });
		const later = formatLearnings(["Two."], { runId: "run-1", isNew: false });
		expect(later).toBe("- Two.\n");
		expect(parseLearnings(`${first}${later}`)).toEqual(["One.", "Two."]);
	});

	test("are none in a line with only the mark, in the header and in other text", () => {
		expect(
			parseLearnings(
				"# Learnings of run run-1\n\n- \n-  \n-no space\nProse.\n- One.\r\n",
			),
		).toEqual(["One."]);
	});
});

describe("a new file", () => {
	test("starts with Night Shift's header, with the run's id in short and whole", () => {
		expect(
			formatLearnings(["One."], { runId: "0123456789", isNew: true }),
		).toBe(
			"# Learnings of run 01234567\n\nWhat the agents of run 0123456789 proposed to learn about this project.\n\n- One.\n",
		);
	});

	test("of a run's own says Night Shift learned it from the run", () => {
		const text = formatLearnings(["One."], {
			runId: "0123456789",
			isNew: true,
			by: "run",
		});
		expect(text).toBe(
			"# Learnings of run 01234567\n\nWhat Night Shift learned from run 0123456789.\n\n- One.\n",
		);
		expect(parseLearnings(text)).toEqual(["One."]);
	});

	test("is nothing without a note to keep", () => {
		expect(formatLearnings([" ", "\n"], { runId: "r", isNew: true })).toBe("");
	});
});

describe("one note out of a file", () => {
	const file =
		"# Learnings of run run-1\n\nWhat the agents of run run-1 proposed to learn about this project.\n\n- One.\n- \nProse.\n- Two.\n- Three.\n";

	test("takes out only that note's line, counted as the notes are read", () => {
		const left = withoutNote(file, 1);
		expect(left).toEqual({
			text: "# Learnings of run run-1\n\nWhat the agents of run run-1 proposed to learn about this project.\n\n- One.\n- \nProse.\n- Three.\n",
			notes: 2,
		});
		expect(parseLearnings(left?.text ?? "")).toEqual(["One.", "Three."]);
	});

	test("says when no note is left, and when there is no such note", () => {
		expect(withoutNote("- Only.\n", 0)).toEqual({ text: "", notes: 0 });
		expect(withoutNote(file, 3)).toBeNull();
		expect(withoutNote(file, -1)).toBeNull();
	});

	test("keeps the lines above the first note as its preface", () => {
		expect(learningPreface(file)).toBe(
			"# Learnings of run run-1\n\nWhat the agents of run run-1 proposed to learn about this project.",
		);
		expect(learningPreface("- One.\n")).toBe("");
	});
});

describe("a note a person decided on", () => {
	const at = parseInstant("2026-11-16T21:30:00Z");

	test("says who told it and when, on a line no reader counts as a note", () => {
		const text = formatPersonNote(
			"  Deploys \n wait for two people. ",
			{ how: "told", by: "Ada  Lovelace", at },
			{ isNew: true },
		);
		expect(text).toBe(
			"# Learnings people told\n\nWhat a person of this Space told agents about this project.\n\n- Deploys wait for two people.\n  Told by Ada Lovelace on 2026-11-16.\n",
		);
		expect(parseLearnings(text)).toEqual(["Deploys wait for two people."]);
	});

	test("kept, it starts a new file with the proposal's preface", () => {
		const mark = { how: "kept" as const, by: "Ada", at };
		expect(
			formatPersonNote("One.", mark, {
				isNew: true,
				preface: "# Learnings of run r",
			}),
		).toBe("# Learnings of run r\n\n- One.\n  Kept by Ada on 2026-11-16.\n");
		expect(
			formatPersonNote("One.", mark, { isNew: false, preface: "# X" }),
		).toBe("- One.\n  Kept by Ada on 2026-11-16.\n");
		expect(
			formatPersonNote("One.", { ...mark, by: " " }, { isNew: false }),
		).toBe("- One.\n  Kept by a person on 2026-11-16.\n");
	});

	test("is nothing without a note", () => {
		expect(
			formatPersonNote(" \n", { how: "told", by: "Ada", at }, { isNew: true }),
		).toBe("");
	});
});
