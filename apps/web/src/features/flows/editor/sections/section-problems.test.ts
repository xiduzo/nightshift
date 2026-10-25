import { describe, expect, test } from "bun:test";
import type { SectionProblem } from "@nightshift/flows";
import { quotedList, sectionProblemText } from "./section-problems";

const flow = {
	sections: [
		{ id: "review", label: "Review", nodes: ["ux", "code"] },
		{ id: "ship", label: "", nodes: ["publish"] },
	],
};
const text = (problem: SectionProblem) => sectionProblemText(flow, problem);

describe("sectionProblemText", () => {
	test("words every problem code", () => {
		expect(text({ code: "empty" })).toBe(
			"Select the nodes for the Section first.",
		);
		expect(text({ code: "unknown-nodes", nodes: ["zz"] })).toContain('"zz"');
		expect(text({ code: "not-connected", parts: [["a"], ["b"]] })).toContain(
			"do not connect",
		);
		expect(text({ code: "no-entry" })).toContain("one way in");
		expect(text({ code: "several-entries", entries: ["ux", "security"] })).toBe(
			'The flow comes in at "ux" and "security". A Section has one way in. Add the nodes before them, or select fewer.',
		);
	});

	test("names the Sections that hold the nodes already", () => {
		expect(
			text({
				code: "in-other-section",
				nodes: [
					{ node: "ux", section: "review" },
					{ node: "code", section: "review" },
					{ node: "publish", section: "ship" },
				],
			}),
		).toBe(
			'"ux" and "code" are in the Section "Review" already. "publish" is in the Section "ship" already. A node can be in one Section only.',
		);
	});

	test("keeps sentences short", () => {
		const problems: SectionProblem[] = [
			{ code: "empty" },
			{ code: "not-connected", parts: [] },
			{ code: "no-entry" },
			{ code: "several-entries", entries: ["a", "b"] },
		];
		for (const problem of problems) {
			for (const sentence of text(problem).split(". ")) {
				expect(sentence.split(" ").length).toBeLessThanOrEqual(20);
			}
		}
	});

	test("lists ids with and", () => {
		expect(quotedList([])).toBe("");
		expect(quotedList(["a"])).toBe('"a"');
		expect(quotedList(["a", "b", "c"])).toBe('"a", "b" and "c"');
	});
});
