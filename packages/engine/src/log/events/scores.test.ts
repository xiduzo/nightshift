import { describe, expect, test } from "bun:test";
import { flowScores, runScore } from "./scores";

const scored = (score: string, value = 1) => ({
	stepId: null,
	at: 5,
	payload: { score, value, label: null },
});

describe("runScore", () => {
	test("keeps the name, value and label, and a name Night Shift does not know", () => {
		expect(runScore(scored("pr_useful", 0))).toEqual({
			score: "pr_useful",
			value: 0,
			label: null,
			stepId: null,
			at: 5,
			by: null,
		});
	});
});

describe("flowScores", () => {
	test("refuses the names Night Shift writes, the useful answer included", () => {
		const { scores, refused } = flowScores({
			scores: { useful: 1, found: 4 },
		});
		expect(scores).toEqual([{ score: "found", value: 4 }]);
		expect(refused).toEqual([
			'The step wrote the score "useful". Night Shift keeps that name for itself. Choose another name.',
		]);
	});
});
