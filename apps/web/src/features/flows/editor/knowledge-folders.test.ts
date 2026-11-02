import { describe, expect, test } from "bun:test";

import { foldersOf } from "./knowledge-folders";

describe("the folders an Agent node may pick", () => {
	test("are every folder that holds a file, at any depth, but not Night Shift's own", () => {
		expect(
			foldersOf([
				"README.md",
				"books/graham.md",
				"research/papers/2013-gem.md",
				"research/replications/gem.md",
				"learnings/accepted/costs.md",
				"learnings/proposed/run-1.s1.md",
				"evals/questions.md",
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
