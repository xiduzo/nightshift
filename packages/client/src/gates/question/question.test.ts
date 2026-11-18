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

	test("long JSON inside a sentence becomes its own block", () => {
		const findings = [
			{ reviewer: "code", findings: [{ file: "a.kt", problem: 'Say "no".' }] },
		];
		const question = `Approve?\n\nRisks to check: Findings still open: ${JSON.stringify(findings)} Builder: built. Tests pass.`;
		expect(parseGateQuestion(question).context).toEqual([
			{ label: null, kind: "text", value: "Risks to check:" },
			{
				label: "Findings still open",
				kind: "code",
				language: "json",
				value: JSON.stringify(findings, null, 2),
			},
			{ label: null, kind: "text", value: "Builder: built. Tests pass." },
		]);
	});

	test("short JSON and brackets in prose stay in the sentence", () => {
		const text = 'Set {"a":1} and see [the docs](https://x.y) for [1, 2].';
		expect(parseGateQuestion(`Go on?\n\n${text}`).context).toEqual([
			{ label: null, kind: "text", value: text },
		]);
	});

	test("a Label: last line of a paragraph names the block below it", () => {
		expect(
			parseGateQuestion(
				"Go on?\n\nBuilder: built.\nOpen findings:\n\n```json\n[1]\n```",
			).context,
		).toEqual([
			{ label: null, kind: "text", value: "Builder: built." },
			{
				label: "Open findings",
				kind: "code",
				language: "json",
				value: "[\n  1\n]",
			},
		]);
	});

	test("one fact per line keeps its line, lists keep their Markdown", () => {
		expect(
			parseGateQuestion("Go on?\n\nBuilder: built.\nTests: pass.\n- one\n- two")
				.context,
		).toEqual([
			{
				label: null,
				kind: "text",
				value: "Builder: built.  \nTests: pass.\n- one\n- two",
			},
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

	test("a label above a list of links goes with the links", () => {
		const parts = gateParts(
			"Review them?\n\nDraft pull requests:\n\n- https://github.com/a/b/pull/3\n- https://github.com/a/b/pull/4\n\nBuilder: built.",
		);
		expect(parts.context).toEqual([
			{ label: null, kind: "text", value: "Builder: built." },
		]);
		expect(parts.links.map((link) => link.short)).toEqual(["#3", "#4"]);
	});
});
