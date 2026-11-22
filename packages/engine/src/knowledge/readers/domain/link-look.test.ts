import { describe, expect, test } from "bun:test";
import {
	createLookMemo,
	emptyLook,
	LOOK_WORDS,
	lookKey,
	notReadLook,
	pagesUnder,
	perWeek,
	startsFolder,
} from "./link-look";

const DAY = 24 * 60 * 60_000;

describe("the quick look", () => {
	test("its words", () => {
		expect(LOOK_WORDS).toEqual({
			notAnAddress: "This is not a web address.",
			notWeb: "The address must start with http:// or https://.",
			robots: "The site asks readers to stay away from this page.",
			noAnswer: "The page did not answer.",
			late: "The page did not answer in time.",
			media: "This is video or audio. An agent can get its transcript.",
		});
	});

	test("a feed's items a week, over the last four weeks", () => {
		const at = 100 * DAY;
		expect(perWeek([], at)).toBeNull();
		expect(perWeek([at - DAY, at - 2 * DAY, at - 3 * DAY], at)).toBe(0.8);
		expect(perWeek([at - 40 * DAY, at + DAY], at)).toBe(0);
	});

	test("an address starts its folder when it is the folder, or its index", () => {
		expect(startsFolder("https://example.com/docs/")).toBe(true);
		expect(startsFolder("https://example.com/docs/index.html")).toBe(true);
		expect(startsFolder("https://example.com/docs/Getting-Started")).toBe(true);
		expect(startsFolder("https://example.com/docs/refunds")).toBe(false);
	});

	test("the pages under a folder count once each", () => {
		expect(
			pagesUnder("https://example.com/docs/", [
				"https://example.com/docs/a?x=1",
				"https://example.com/docs/a",
				"https://example.com/docs/b#top",
				"https://example.com/blog/c",
			]),
		).toBe(2);
	});

	test("a page a reader could not read says why", () => {
		expect(
			notReadLook("https://example.com/a", {
				status: "signin",
				reason: "The page asks you to sign in first.",
			}),
		).toEqual({
			...emptyLook("https://example.com/a"),
			kind: "signin",
			reason: "The page asks you to sign in first.",
		});
	});

	test("a look is kept five minutes, and at most 200 are kept, the oldest going first", () => {
		const memo = createLookMemo();
		const look = {
			...emptyLook("https://example.com/a"),
			kind: "page" as const,
		};
		const key = lookKey("p1", "nightshift", "https://example.com/a");
		expect(key).toBe("p1 nightshift https://example.com/a");
		memo.keep(key, 0, look);
		expect(memo.get(key, 5 * 60_000 - 1)).toBe(look);
		expect(memo.get(key, 5 * 60_000)).toBeNull();
		for (let index = 0; index <= 200; index++) {
			memo.keep(`k${index}`, 1_000, look);
		}
		expect(memo.get(key, 1_000)).toBeNull();
		expect(memo.get("k0", 1_000)).toBeNull();
		expect(memo.get("k1", 1_000)).toBe(look);
		expect(memo.get("k200", 1_000)).toBe(look);
	});
});
