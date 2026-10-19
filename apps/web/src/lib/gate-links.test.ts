import { describe, expect, test } from "bun:test";

import { describeLink, extractGateLinks } from "./gate-links";

const PR = "https://github.com/infonl/dimpact-zaakafhandelcomponent/pull/7515";

describe("extractGateLinks", () => {
	test("a line with only a labelled link leaves the text and keeps its label", () => {
		const { links, question } = extractGateLinks(
			`Night Shift fixed PZ-12908.\n\nDraft pull request: ${PR}\n\n## What was wrong\nIt did not check.`,
		);
		expect(links).toEqual([
			{
				url: PR,
				label: "Draft pull request",
				short: "#7515",
				where: "infonl/dimpact-zaakafhandelcomponent",
				kind: "pull",
			},
		]);
		expect(question).toBe(
			"Night Shift fixed PZ-12908.\n\n## What was wrong\nIt did not check.",
		);
	});

	test("a list of links leaves the text, each link once", () => {
		const { links, question } = extractGateLinks(
			"Merge these?\n\n- https://github.com/a/b/pull/1\n- https://github.com/a/b/pull/2\n- https://github.com/a/b/pull/1",
		);
		expect(links.map((link) => link.short)).toEqual(["#1", "#2"]);
		expect(question).toBe("Merge these?\n");
	});

	test("a link inside a sentence stays and is listed without its full stop", () => {
		const text = "See https://dimpact.atlassian.net/browse/PZ-1. Then answer.";
		const { links, question } = extractGateLinks(text);
		expect(question).toBe(text);
		expect(links).toEqual([
			{
				url: "https://dimpact.atlassian.net/browse/PZ-1",
				label: "Ticket",
				short: "PZ-1",
				where: "dimpact.atlassian.net",
				kind: "ticket",
			},
		]);
	});

	test("links in code stay code", () => {
		const text = "Apply this?\n\n```diff\n+ url: https://example.com\n```";
		expect(extractGateLinks(text)).toEqual({ links: [], question: text });
	});
});

describe("describeLink", () => {
	test("a GitHub issue", () => {
		expect(describeLink("https://github.com/a/b/issues/9", null)).toMatchObject(
			{
				label: "Issue",
				short: "#9",
				where: "a/b",
				kind: "issue",
			},
		);
	});

	test("any other page is named by its host", () => {
		expect(
			describeLink("https://www.example.com/docs/setup", "Setup guide"),
		).toEqual({
			url: "https://www.example.com/docs/setup",
			label: "Setup guide",
			short: "example.com",
			where: "example.com",
			kind: "web",
		});
	});
});
