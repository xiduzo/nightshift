import { describe, expect, test } from "bun:test";
import { formatLearnings } from "@nightshift/flows";
import {
	emptyNote,
	learningGone,
	learningUnavailable,
	noteGone,
	noteIn,
	waitingKey,
	withNearTo,
} from "./waiting";

describe("the words a person reads", () => {
	test("are whole", () => {
		expect([
			learningGone(),
			learningUnavailable(),
			noteGone(),
			emptyNote(),
		]).toEqual([
			expect.objectContaining({
				kind: "not-found",
				message: "This learning no longer waits. Someone kept or deleted it.",
			}),
			expect.objectContaining({
				kind: "unavailable",
				message:
					"Night Shift cannot get this learning now. Try again when the computer that keeps this Space is online.",
			}),
			expect.objectContaining({
				kind: "not-found",
				message:
					"This note no longer waits. Someone kept, changed or deleted it.",
			}),
			expect.objectContaining({
				kind: "invalid",
				message: "Write the note first.",
			}),
		]);
	});
});

describe("waitingKey", () => {
	test("names only the proposed files, with their content, in one order", () => {
		const a = waitingKey([
			["learnings/proposed/run-2.md", { sha256: "b" }],
			["learnings/accepted/run-1.md", { sha256: "c" }],
			["learnings/proposed/run-1.s1.md", { sha256: "a" }],
		]);
		expect(a).toBe(
			"learnings/proposed/run-1.s1.md:a\nlearnings/proposed/run-2.md:b",
		);
	});
});

describe("noteIn", () => {
	const text = formatLearnings(["One.", "Two."], {
		runId: "run-1",
		isNew: true,
	});

	test("finds a note by its place, or by its text when it moved", () => {
		expect(noteIn(text, { id: "x", index: 1 }).note).toBe("Two.");
		const moved = noteIn(text, { id: "x", index: 1, note: "One." });
		expect(moved.note).toBe("One.");
		expect(moved.rest.notes).toBe(1);
		expect(moved.rest.text).toContain("- Two.");
	});

	test("refuses a note the file no longer has", () => {
		expect(() => noteIn(text, { id: "x", index: 0, note: "Three." })).toThrow(
			"This note no longer waits.",
		);
		expect(() => noteIn(text, { id: "x", index: 5 })).toThrow();
	});
});

describe("withNearTo", () => {
	test("puts each list of close notes on its note, and none where none is close", () => {
		const near = { id: "b.md", note: "B.", kept: true, similarity: 0.9 };
		const learnings = [
			{
				id: "a.md",
				runId: "a",
				stepId: null,
				notes: ["A1.", "A2."],
				proposedAt: 1,
			},
			{ id: "c.md", runId: "c", stepId: null, notes: ["C."], proposedAt: 2 },
		];
		expect(withNearTo(learnings, [[], [near], []])).toEqual([
			{ ...learnings[0], nearTo: [[], [near]] } as never,
			learnings[1] as never,
		]);
	});
});
