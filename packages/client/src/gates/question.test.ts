import { describe, expect, test } from "bun:test";

import { type ContextItem, gateParts, parseGateQuestion } from "./question";

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

	test("paragraphs without a label stay one Markdown text", () => {
		expect(
			parseGateQuestion("Ship it?\n\n## Changes\n\n1. Login\n\n2. Logout"),
		).toEqual({
			headline: "Ship it?",
			context: [
				{
					label: null,
					kind: "text",
					value: "## Changes\n\n1. Login\n\n2. Logout",
				},
			],
		});
	});

	test("JSON shows pretty-printed, with or without a fence", () => {
		const pretty = '{\n  "ok": true,\n  "items": [\n    1\n  ]\n}';
		const json = (label: string): ContextItem => ({
			label,
			kind: "code",
			language: "json",
			value: pretty,
		});
		expect(
			parseGateQuestion('Go on?\n\nResult: {"ok":true,"items":[1]}').context,
		).toEqual([json("Result")]);
		expect(
			parseGateQuestion('Go on?\n\nResult:\n{"ok":true,"items":[1]}').context,
		).toEqual([json("Result")]);
		expect(
			parseGateQuestion('Go on?\n\n{"ok":true,"items":[1]}').context,
		).toEqual([json("json")]);
		expect(
			parseGateQuestion('Go on?\n\n```\n{"ok":true,"items":[1]}\n```').context,
		).toEqual([json("json")]);
	});

	test("text that only looks like JSON stays text", () => {
		expect(parseGateQuestion("Go on?\n\n{not json}").context).toEqual([
			{ label: null, kind: "text", value: "{not json}" },
		]);
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
