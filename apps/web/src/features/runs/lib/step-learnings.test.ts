import { describe, expect, test } from "bun:test";
import { formatLearnings, parseLearnings } from "@nightshift/flows";
import type { TranscriptItem } from "../transcript/transcript-items";
import { stepLearnings } from "./step-learnings";

const report = (learnings?: string[]): TranscriptItem => ({
	kind: "report",
	key: `report:${learnings?.length ?? 0}`,
	sessionId: "s1",
	at: 0,
	outcome: "pass",
	summary: "Done.",
	...(learnings ? { learnings } : {}),
});

describe("the learnings of a step", () => {
	test("every report's notes, in order, one line each", () => {
		expect(
			stepLearnings([
				report(["Tests run with  bun test.\n", " "]),
				{ kind: "finished", key: "finished:1", sessionId: "s1", at: 1 },
				report(["The API lives in packages/api."]),
			]),
		).toEqual(["Tests run with bun test.", "The API lives in packages/api."]);
	});

	test("shows each note as it is kept", () => {
		const notes = [
			"Tests run with  bun test.\n",
			" ",
			"\t- Starts with a dash.\r\nOn two lines. ",
			"# Looks like a title",
			"\u00a0Odd\u2028spaces\u00a0",
		];
		const kept = parseLearnings(
			formatLearnings(notes, { runId: "run-1", isNew: true }),
		);
		expect(kept).toHaveLength(4);
		expect(stepLearnings([report(notes)])).toEqual(kept);
	});

	test("none without a report that proposes one", () => {
		expect(stepLearnings([report()])).toEqual([]);
		expect(stepLearnings([])).toEqual([]);
	});
});
