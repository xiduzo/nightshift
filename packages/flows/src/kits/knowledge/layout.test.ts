import { describe, expect, test } from "bun:test";
import {
	ACCEPTED_LEARNINGS_DIR,
	isHiddenFromReaders,
	isKnowledgeOwnFolder,
	isProposedLearning,
	isProposedLearningFile,
	isQuestionSetPath,
	KNOWLEDGE_INDEX_FILE,
	KNOWLEDGE_OWN_FOLDERS_WORDS,
	KNOWLEDGE_RECONCILE_FILE,
	KNOWLEDGE_SEARCH_FILE,
	KNOWLEDGE_STAGING_SUFFIX,
	knowledgeFoldersOf,
	NOT_TOPICS_FILE,
	PROPOSED_LEARNINGS_DIR,
	proposedLearningFileName,
	proposedLearningOf,
	QUESTION_SET_FILE,
} from "./layout";

describe("the layout of the knowledge folder", () => {
	// On the disk of every Device, in the Space's document and in copied kits.
	test("keeps the names that are already out there", () => {
		expect({
			PROPOSED_LEARNINGS_DIR,
			ACCEPTED_LEARNINGS_DIR,
			NOT_TOPICS_FILE,
			QUESTION_SET_FILE,
			KNOWLEDGE_INDEX_FILE,
			KNOWLEDGE_SEARCH_FILE,
			KNOWLEDGE_RECONCILE_FILE,
			KNOWLEDGE_STAGING_SUFFIX,
			KNOWLEDGE_OWN_FOLDERS_WORDS,
		}).toEqual({
			PROPOSED_LEARNINGS_DIR: "learnings/proposed",
			ACCEPTED_LEARNINGS_DIR: "learnings/accepted",
			QUESTION_SET_FILE: "evals/questions.json",
			NOT_TOPICS_FILE: "evals/not-topics.json",
			KNOWLEDGE_INDEX_FILE: "INDEX.md",
			KNOWLEDGE_SEARCH_FILE: ".search.sqlite",
			KNOWLEDGE_RECONCILE_FILE: ".reconciled.json",
			KNOWLEDGE_STAGING_SUFFIX: ".part",
			KNOWLEDGE_OWN_FOLDERS_WORDS: "learnings and evals are Night Shift's own.",
		});
	});

	test.each([
		// Path, a source may not fill it, nobody reads it.
		["learnings", true, false],
		["learnings/proposed", true, true],
		["learnings/proposed/run-1.s1.md", true, true],
		// The one folder where the two answers part.
		["learnings/accepted", true, false],
		["learnings/accepted/run-1.s1.md", true, false],
		["evals", true, true],
		["evals/questions.json", true, true],
		["books", false, false],
		// A name that only starts like one of them is not in it.
		["learnings-old", false, false],
		["evalsuite/a.md", false, false],
		["learnings/proposed-old/a.md", true, false],
	])("%s: own %p, hidden %p", (path, own, hidden) => {
		expect(isKnowledgeOwnFolder(path)).toBe(own);
		expect(isHiddenFromReaders(path)).toBe(hidden);
	});

	test("tells a proposed learning's file from its folder, and from the question set", () => {
		expect(isProposedLearning(PROPOSED_LEARNINGS_DIR)).toBe(true);
		expect(isProposedLearningFile(PROPOSED_LEARNINGS_DIR)).toBe(false);
		expect(isProposedLearningFile("learnings/proposed/run-1.s1.md")).toBe(true);
		expect(isProposedLearningFile("learnings/proposed/deep/run-1.md")).toBe(
			false,
		);
		expect(isProposedLearningFile("learnings/proposed/run-1.txt")).toBe(false);
		expect(isQuestionSetPath(QUESTION_SET_FILE)).toBe(true);
		expect(isQuestionSetPath("learnings/proposed/run-1.md")).toBe(false);
	});

	test("names a step's proposed learnings, and reads the name back", () => {
		const both = proposedLearningFileName({ runId: "run-1", stepId: "s_1" });
		expect(both).toBe("run-1.s_1.md");
		expect(proposedLearningOf(both)).toEqual({
			runId: "run-1",
			stepId: "s_1",
		});
		const old = proposedLearningFileName({ runId: "run-1" });
		expect(old).toBe("run-1.md");
		expect(proposedLearningOf(old)).toEqual({ runId: "run-1", stepId: null });
	});

	test("refuses a name that could leave the folder", () => {
		expect(() => proposedLearningFileName({ runId: "../x" })).toThrow(
			'"../x" is not an id.',
		);
		expect(() =>
			proposedLearningFileName({ runId: "run-1", stepId: "a/b" }),
		).toThrow('"a/b" is not an id.');
		for (const name of ["run-1", "../x.md", ".md", "a.b.c.md", "a.b/c.md"]) {
			expect(proposedLearningOf(name)).toBeNull();
		}
	});

	test("gives every folder that holds a file, at any depth, sorted", () => {
		expect(
			knowledgeFoldersOf([
				"README.md",
				"research/papers/2013-gem.md",
				"books/graham.md",
				"research/replications/gem.md",
				"learnings/accepted/costs.md",
			]),
		).toEqual([
			"books",
			"learnings",
			"learnings/accepted",
			"research",
			"research/papers",
			"research/replications",
		]);
	});
});
