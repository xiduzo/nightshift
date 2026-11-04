import { describe, expect, test } from "bun:test";
import {
	ACCEPTED_LEARNINGS_DIR,
	IS_PROPOSED_LEARNING_SHELL,
	isHiddenFromReaders,
	isKnowledgeOwnFolder,
	isProposedLearning,
	isQuestionSetPath,
	KNOWLEDGE_INDEX_FILE,
	KNOWLEDGE_OWN_FOLDERS_WORDS,
	KNOWLEDGE_RECONCILE_FILE,
	KNOWLEDGE_SEARCH_FILE,
	KNOWLEDGE_STAGING_SUFFIX,
	knowledgeFoldersOf,
	NOT_TOPICS_FILE,
	PROPOSED_LEARNINGS_DIR,
	proposedLearningAt,
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
		expect(proposedLearningAt(PROPOSED_LEARNINGS_DIR)).toBeNull();
		expect(proposedLearningAt("learnings/proposed/run-1.s1.md")).toEqual({
			id: "run-1.s1.md",
			runId: "run-1",
			stepId: "s1",
		});
		expect(proposedLearningAt("learnings/proposed/run-1.md")).toEqual({
			id: "run-1.md",
			runId: "run-1",
			stepId: null,
		});
		for (const path of [
			"learnings/proposed/deep/run-1.md",
			"learnings/proposed/run-1.txt",
			"learnings/proposed/my notes.md",
			"learnings/accepted/run-1.md",
			"run-1.md",
		]) {
			expect(proposedLearningAt(path)).toBeNull();
		}
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

	test("the shell's rule for a proposed learning's name is the same as this one", async () => {
		const parts = [
			"a",
			"Z9",
			"run-1",
			"s_1",
			"-",
			"_",
			".",
			"..",
			" ",
			"/",
			"é",
			"*",
			"$",
			"'",
			"\n",
			"md",
			".md",
			".MD",
		];
		const names = new Set<string>(["", ".", ".md", "..md", "a.b.c.md"]);
		for (const first of parts) {
			for (const second of parts) {
				names.add(`${first}${second}`);
				names.add(`${first}${second}.md`);
				for (const third of parts) {
					names.add(`${first}.${second}.${third}`);
					names.add(`${first}${second}${third}.md`);
				}
			}
		}
		const all = [...names];
		/** The shell's answer for each name, in order. */
		const answers = async (some: string[]): Promise<string[]> => {
			const proc = Bun.spawn(
				[
					"/bin/sh",
					"-c",
					`${IS_PROPOSED_LEARNING_SHELL}
for name in "$@"; do
	if is_proposed_learning "$name"; then echo yes; else echo no; fi
done`,
					"sh",
					...some,
				],
				{ stdout: "pipe" },
			);
			const out = await new Response(proc.stdout).text();
			expect(await proc.exited).toBe(0);
			return out.trim().split("\n");
		};
		// In parts: a shell function call copies all the arguments of its caller.
		const lines: string[] = [];
		for (let at = 0; at < all.length; at += 500) {
			lines.push(...(await answers(all.slice(at, at + 500))));
		}
		expect(lines).toHaveLength(all.length);
		const differ = all.filter(
			(name, i) => (lines[i] === "yes") !== (proposedLearningOf(name) !== null),
		);
		expect(differ).toEqual([]);
		// The test proves something only when both answers occur.
		expect(lines).toContain("yes");
		expect(lines).toContain("no");
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
