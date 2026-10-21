import { describe, expect, test } from "bun:test";

import { gateParts, parseGateQuestion } from "./question";

describe("parseGateQuestion", () => {
	test("a question of one paragraph has no context", () => {
		expect(parseGateQuestion("Ship it?")).toEqual({
			headline: "Ship it?",
			context: [],
		});
	});

	test("the first paragraph is the headline, a labelled paragraph keeps its label", () => {
		expect(
			parseGateQuestion("Merge the fix?\n\nSummary:\nIt checks the token."),
		).toEqual({
			headline: "Merge the fix?",
			context: [
				{ label: "Summary", kind: "text", value: "It checks the token." },
			],
		});
	});

	test("a label right above a fence names the code", () => {
		expect(
			parseGateQuestion("Apply this?\n\nChanges:\n\n```diff\n+a\n-b\n```"),
		).toEqual({
			headline: "Apply this?",
			context: [
				{ label: "Changes", kind: "code", language: "diff", value: "+a\n-b" },
			],
		});
	});

	test("a question that starts with code is all headline", () => {
		const text = "```\nx\n```\nOK?";
		expect(parseGateQuestion(text)).toEqual({ headline: text, context: [] });
	});
});

describe("gateParts", () => {
	test("takes the link lines out of the context and lists them", () => {
		const parts = gateParts(
			"Review the pull request?\n\nPull request: https://github.com/a/b/pull/3",
		);
		expect(parts.headline).toBe("Review the pull request?");
		expect(parts.context).toEqual([]);
		expect(parts.links.map((link) => link.short)).toEqual(["#3"]);
	});
});
