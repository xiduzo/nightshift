import { describe, expect, test } from "bun:test";

import type { WaitingLearning } from "./learnings";
import { checkedNoteKey, notesToCheck } from "./use-check-notes";

const close = { id: "kept.md", note: "Use bun.", kept: true, similarity: 0.9 };

const learnings: WaitingLearning[] = [
	{
		id: "run-2.s1.md",
		projectId: "p1",
		runId: "run-2",
		stepId: "s1",
		notes: ["Use bun test.", "Deploys wait."],
		proposedAt: 2,
		mayDecide: true,
		nearTo: [[close], []],
	},
	{
		id: "run-1.md",
		projectId: "p2",
		runId: "run-1",
		stepId: null,
		notes: ["Night Shift learned this."],
		proposedAt: 1,
		mayDecide: false,
	},
];

describe("the notes to check", () => {
	test("are one each, in the order of the learnings, with the notes close to each", () => {
		expect(notesToCheck(learnings, new Set())).toEqual([
			{
				projectId: "p1",
				learningId: "run-2.s1.md",
				index: 0,
				note: "Use bun test.",
				nearTo: [close],
				mayDecide: true,
				proposedAt: 2,
			},
			{
				projectId: "p1",
				learningId: "run-2.s1.md",
				index: 1,
				note: "Deploys wait.",
				nearTo: [],
				mayDecide: true,
				proposedAt: 2,
			},
			{
				projectId: "p2",
				learningId: "run-1.md",
				index: 0,
				note: "Night Shift learned this.",
				nearTo: [],
				mayDecide: false,
				proposedAt: 1,
			},
		]);
	});

	test("leave out a note on its way: kept, deleted or changed, by its text and not its place", () => {
		const settled = checkedNoteKey({
			projectId: "p1",
			learningId: "run-2.s1.md",
			note: "Use bun test.",
		});
		const changed = checkedNoteKey({
			projectId: "p2",
			note: "Night Shift learned that.",
			replaces: { learningId: "run-1.md", note: "Night Shift learned this." },
		});
		const left = notesToCheck(
			learnings,
			new Set([settled, changed].filter((key) => key !== null)),
		);
		expect(left.map(({ note, index }) => [note, index])).toEqual([
			["Deploys wait.", 1],
		]);
	});

	test("a note the person tells of their own leaves none out", () => {
		expect(checkedNoteKey({ projectId: "p1", note: "New." })).toBeNull();
	});
});
