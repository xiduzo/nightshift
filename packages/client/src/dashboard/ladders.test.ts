import { describe, expect, test } from "bun:test";

import {
	type LadderRungRow,
	type LadderSummary,
	ladderParts,
	landedText,
	nodeLadderLabel,
	rungLabel,
	shareText,
	unsureText,
} from "./ladders";

const FREE = { costUsd: 0, costEstimated: false, costMissing: 0 };

function row(fields: Partial<LadderRungRow>): LadderRungRow {
	return {
		rung: "first",
		by: "agent",
		tier: null,
		landed: 1,
		costPerLanding: FREE,
		...fields,
	};
}

function ladder(rungs: LadderRungRow[]): LadderSummary {
	return { landed: rungs.reduce((sum, r) => sum + r.landed, 0), rungs };
}

describe("where the work landed", () => {
	test("names a rung by its tier, else by who worked on it", () => {
		expect(rungLabel(row({ tier: "Sonnet" }))).toBe("Sonnet");
		expect(rungLabel(row({ by: "flow" }))).toBe("Subflow");
		expect(rungLabel(row({ by: "model" }))).toBe("Decider");
		expect(rungLabel(row({ rung: "rule", by: "rule" }))).toBe("Rule");
		// A person tier is you, whatever its name.
		expect(rungLabel(row({ rung: "person", by: "person", tier: "Ask" }))).toBe(
			"You",
		);
		expect(rungLabel(row({ rung: "deadline", by: "person" }))).toBe(
			"Its deadline",
		);
		expect(rungLabel(row({ rung: "none", tier: "Opus" }))).toBe("Nowhere");
	});

	test("gives each rung its share, in one line", () => {
		const work = ladder([
			row({ tier: "Sonnet", landed: 78 }),
			row({ tier: "Opus", rung: "later", landed: 19 }),
			row({ rung: "person", by: "person", landed: 3 }),
		]);
		expect(shareText(work)).toBe("Sonnet 78% · Opus 19% · You 3%");
		expect(ladderParts(work).map((part) => part.key)).toEqual([
			"first:Sonnet",
			"later:Opus",
			"person:You",
		]);
	});

	test("keeps the biggest rungs in ladder order when there are many", () => {
		const work = ladder([
			row({ tier: "Haiku", landed: 1 }),
			row({ tier: "Sonnet", landed: 500 }),
			row({ tier: "Opus", rung: "later", landed: 100 }),
			row({ rung: "person", by: "person", landed: 50 }),
			row({ rung: "none", landed: 2 }),
		]);
		expect(shareText(work)).toBe("Sonnet 77% · Opus 15% · You 8% · 2 more");
		// A share above 0 never reads as nothing.
		expect(ladderParts(work)[0]?.share).toBe("<1%");
	});

	test("counts landings in times, and how sure the deciders were", () => {
		expect(landedText(32, 41)).toBe("32 of 41 times");
		expect(landedText(1, 1)).toBe("1 of 1 time");
		expect(unsureText({ picked: 50, unsure: 6 })).toBe(
			"A decider was not sure enough in 6 of 50 Decisions.",
		);
		expect(unsureText({ picked: 12, unsure: 0 })).toBe(
			"A decider was sure enough in all 12 Decisions.",
		);
		expect(unsureText({ picked: 0, unsure: 0 })).toBeNull();
	});

	test("names a node after the Subflow nodes it ran in", () => {
		expect(nodeLadderLabel({ nodeId: "draft" })).toBe("draft");
		expect(nodeLadderLabel({ nodeId: "draft", via: "outer/write" })).toBe(
			"outer / write / draft",
		);
	});
});
