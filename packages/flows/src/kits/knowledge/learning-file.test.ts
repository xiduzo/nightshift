import { describe, expect, test } from "bun:test";
import {
	formatLearnings,
	learningNotes,
	parseLearnings,
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

	test("is nothing without a note to keep", () => {
		expect(formatLearnings([" ", "\n"], { runId: "r", isNew: true })).toBe("");
	});
});
