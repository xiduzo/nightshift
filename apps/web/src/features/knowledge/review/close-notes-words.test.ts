import { describe, expect, test } from "bun:test";
import type { ReviewTask } from "@nightshift/client";
import { closeNotesShown, closeNotesTitle } from "./close-notes-words";

const learning = (id: string) =>
	({
		kind: "learning",
		id: `learning:${id}`,
		node: `learning:${id}`,
		learning: {
			id,
			projectId: "p1",
			runId: "r",
			stepId: null,
			notes: ["A note."],
			proposedAt: 1,
		},
	}) as ReviewTask;

const near = (id: string, note: string, kept: boolean) => ({
	id,
	note,
	kept,
	similarity: 0.9,
});

describe("close notes on the Review page", () => {
	test("a kept note, a note of this step, and a note that also waits, each per note", () => {
		const shown = closeNotesShown(
			{
				id: "a.md",
				notes: ["One.", "Two."],
				nearTo: [
					[near("k.md", "Kept.", true), near("b.md", "Waits.", false)],
					[near("a.md", "One.", false)],
				],
			},
			[learning("a.md"), learning("b.md")],
		);
		expect(
			shown[0]?.map(({ label, note, taskId }) => [label, note, taskId]),
		).toEqual([
			["Close to a kept note", "Kept.", null],
			["Close to a note that also waits", "Waits.", "learning:b.md"],
		]);
		expect(shown[1]?.map(({ label, taskId }) => [label, taskId])).toEqual([
			["Close to a note here", null],
		]);
	});

	test("a note that no longer waits goes at once, a kept one stays", () => {
		const shown = closeNotesShown(
			{
				id: "a.md",
				notes: ["One."],
				nearTo: [
					[near("gone.md", "Gone.", false), near("k.md", "Kept.", true)],
				],
			},
			[learning("a.md")],
		);
		expect(shown[0]?.map(({ note }) => note)).toEqual(["Kept."]);
	});

	test("nothing close, or a Host that does not say: one empty list per note", () => {
		expect(
			closeNotesShown({ id: "a.md", notes: ["One.", "Two."] }, []),
		).toEqual([[], []]);
	});

	test("the words say the notes are close, never that they agree or disagree", () => {
		expect(closeNotesTitle(1)).toBe("1 note is close to another");
		expect(closeNotesTitle(3)).toBe("3 notes are close to others");
	});
});
