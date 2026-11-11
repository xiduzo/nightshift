import { describe, expect, test } from "bun:test";
import { flowScores, runScore } from "./scores";

const scored = (score: string, value = 1) => ({
	stepId: null,
	at: 5,
	payload: { score, value, label: null },
});

describe("runScore", () => {
	test("reads the useful answer of an older log, pr_useful, as useful", () => {
		expect(runScore(scored("pr_useful", 0))).toEqual({
			score: "useful",
			value: 0,
			label: null,
			stepId: null,
			at: 5,
			by: null,
		});
		expect(runScore(scored("useful")).score).toBe("useful");
	});

	test("keeps every other name as it is", () => {
		expect(runScore(scored("pr_merged")).score).toBe("pr_merged");
		expect(runScore(scored("replicated")).score).toBe("replicated");
	});
});

describe("flowScores", () => {
	test("refuses the names Night Shift writes, the useful answer included", () => {
		const { scores, refused } = flowScores({
			scores: { useful: 1, pr_useful: 1, found: 4 },
		});
		expect(scores).toEqual([{ score: "found", value: 4 }]);
		expect(refused).toEqual([
			'The step wrote the score "useful". Night Shift keeps that name for itself. Choose another name.',
			'The step wrote the score "pr_useful". Night Shift keeps that name for itself. Choose another name.',
		]);
	});
});
