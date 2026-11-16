import { describe, expect, test } from "bun:test";

import {
	agentSource,
	type LinkLook,
	linkPlan,
	linksIn,
	oftenCron,
	readSource,
	toldNote,
} from "./told-links";

const look = (over: Partial<LinkLook>): LinkLook => ({
	url: "https://example.com/docs/refunds",
	kind: "page",
	title: "Refunds",
	section: null,
	feed: null,
	items: null,
	fileType: null,
	reason: null,
	...over,
});

const folder = (pages: number, starts: boolean) => ({
	folder: "https://example.com/docs/",
	pages,
	from: "sitemap" as const,
	starts,
});

describe("the links of a told text", () => {
	test("are every web address, once, in order, without the dot that ends a sentence", () => {
		expect(
			linksIn(
				"See https://example.com/a. Also (https://example.com/b) and https://example.com/a",
			),
		).toEqual(["https://example.com/a", "https://example.com/b"]);
		expect(linksIn("No links here.")).toEqual([]);
	});

	test("a text with words besides its links is a note, links and all; only links is none", () => {
		expect(
			toldNote("Refunds take 14 days. The policy is on https://example.com/r"),
		).toBe("Refunds take 14 days. The policy is on https://example.com/r");
		expect(toldNote("https://example.com/a\n https://example.com/b ")).toBe(
			null,
		);
	});
});

describe("what a told link offers", () => {
	test("one page: read it each week", () => {
		expect(linkPlan(look({}))).toEqual({
			action: "read",
			much: null,
			often: "week",
		});
	});

	test("an article in a folder of more pages: just this page first, the folder on choice", () => {
		expect(linkPlan(look({ section: folder(40, false) }))).toEqual({
			action: "read",
			much: {
				choices: [
					{ much: "page", pages: 1 },
					{ much: "all", pages: 40 },
				],
				initial: "page",
			},
			often: "week",
		});
	});

	test("the start of a folder: all its pages up to 100, else the first 100, or all up to the kit's 500", () => {
		expect(
			linkPlan(look({ kind: "section", section: folder(40, true) })),
		).toMatchObject({ much: { initial: "all" } });
		expect(
			linkPlan(look({ kind: "section", section: folder(1300, true) })),
		).toEqual({
			action: "read",
			much: {
				choices: [
					{ much: "page", pages: 1 },
					{ much: "first", pages: 100 },
					{ much: "all", pages: 500 },
				],
				initial: "first",
			},
			often: "week",
		});
	});

	test("a feed each day, a file each week", () => {
		expect(linkPlan(look({ kind: "feed" }))).toMatchObject({ often: "day" });
		expect(linkPlan(look({ kind: "file", fileType: "pdf" }))).toMatchObject({
			action: "read",
			often: "week",
		});
	});

	test("what Night Shift cannot read goes to an agent; a recording only once", () => {
		for (const kind of [
			"signin",
			"needs-browser",
			"blocked",
			"failed",
		] as const) {
			expect(linkPlan(look({ kind }))).toEqual({
				action: "agent",
				transcript: false,
				often: "week",
			});
		}
		expect(linkPlan(look({ kind: "media" }))).toEqual({
			action: "agent",
			transcript: true,
			often: "once",
		});
		expect(linkPlan(look({ kind: "gone" }))).toEqual({ action: "none" });
	});
});

describe("the source of a told link", () => {
	test("just the page: the Web pages kit with the link, read again as chosen", () => {
		expect(
			readSource(look({ section: folder(40, false) }), {
				much: "page",
				often: "week",
			}),
		).toEqual({
			source: {
				kit: "kit:knowledge/web",
				inputs: { urls: "https://example.com/docs/refunds" },
			},
			keepUpToDate: { cron: "0 6 * * 1" },
		});
	});

	test("the folder: follow links, stay in the folder, at most the pages chosen", () => {
		expect(
			readSource(look({ kind: "section", section: folder(1300, true) }), {
				much: "all",
				often: "day",
			}),
		).toEqual({
			source: {
				kit: "kit:knowledge/web",
				inputs: {
					urls: "https://example.com/docs/refunds",
					follow: "true",
					scope: "https://example.com/docs/",
					limit: "500",
				},
			},
			keepUpToDate: { cron: "0 6 * * *" },
		});
	});

	test("only now has no schedule; each month is the first of the month", () => {
		expect(readSource(look({}), { much: "page", often: "once" })).toEqual({
			source: {
				kit: "kit:knowledge/web",
				inputs: { urls: "https://example.com/docs/refunds" },
			},
		});
		expect(oftenCron("month")).toBe("0 6 1 * *");
	});

	test("an agent fetches what the person described, a question, a page or a transcript", () => {
		expect(
			agentSource({ text: " The meeting notes in our shared drive " }, "week"),
		).toEqual({
			source: {
				kit: "kit:knowledge/agent",
				inputs: { what: "The meeting notes in our shared drive" },
			},
			keepUpToDate: { cron: "0 6 * * 1" },
		});
		expect(
			agentSource({ question: "When do invoices go out?" }, "once").source
				.inputs.what,
		).toBe("What answers this question: When do invoices go out?");
		expect(
			agentSource(
				{ link: "https://video.example.com/v/1", transcript: true },
				"once",
			).source.inputs.what,
		).toBe(
			"The transcript of the video or audio at https://video.example.com/v/1",
		);
		expect(
			agentSource(
				{ link: "https://app.example.com/notes", transcript: false },
				"week",
			).source.inputs.what,
		).toBe("The page at https://app.example.com/notes");
	});
});
