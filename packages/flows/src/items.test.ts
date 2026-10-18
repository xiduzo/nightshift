import { describe, expect, test } from "bun:test";
import {
	blockersFirst,
	type ItemState,
	newlyBlocked,
	nextItem,
	normalizeList,
	unfinishedBlockers,
} from "./items";
import type { ListItem } from "./types";

/** An item that depends on the given ids; a dependency counts as not done. */
function item(
	id: string,
	dependsOn: (string | { id: string; done: boolean })[] = [],
	extra: Partial<ListItem> = {},
): ListItem {
	return {
		id,
		title: `Item ${id}`,
		url: null,
		value: { id },
		dependsOn: dependsOn.map((entry) =>
			typeof entry === "string" ? { id: entry, done: false } : entry,
		),
		done: false,
		...extra,
	};
}

function nth(list: readonly ListItem[], index: number): ListItem {
	const found = list[index];
	if (found === undefined) throw new Error(`no item at ${index}`);
	return found;
}

const ids = (items: readonly ListItem[]) => items.map((entry) => entry.id);

function ordered(items: ListItem[]): ListItem[] {
	const result = blockersFirst(items);
	if (!result.ok) throw new Error(`cycle: ${result.cycle.join(", ")}`);
	return result.items;
}

describe("blockersFirst", () => {
	test("keeps the source order when nothing is blocked", () => {
		expect(ordered([item("3"), item("1"), item("2")]).map((i) => i.id)).toEqual(
			["3", "1", "2"],
		);
	});

	test("puts a blocker before the items it blocks", () => {
		const result = ordered([item("1", ["2"]), item("2"), item("3")]);
		expect(ids(result)).toEqual(["2", "1", "3"]);
	});

	test("takes the first free item each time, like the script", () => {
		// 1 waits on 3, 2 waits on 1. 3 is the only free item, then 1, then 2.
		const result = ordered([item("1", ["3"]), item("2", ["1"]), item("3")]);
		expect(ids(result)).toEqual(["3", "1", "2"]);
	});

	test("among free items the source order stays", () => {
		const result = ordered([
			item("a", ["c"]),
			item("b"),
			item("c"),
			item("d", ["b"]),
		]);
		expect(ids(result)).toEqual(["b", "c", "a", "d"]);
	});

	test("blockers outside the list do not change the order", () => {
		const result = ordered([item("1", ["99"]), item("2")]);
		expect(ids(result)).toEqual(["1", "2"]);
	});

	test("an item blocked by itself is free", () => {
		expect(ids(ordered([item("1", ["1"]), item("2")]))).toEqual(["1", "2"]);
	});

	test("done items are ordered too", () => {
		const result = ordered([item("1", ["2"]), item("2", [], { done: true })]);
		expect(ids(result)).toEqual(["2", "1"]);
	});

	test("an empty list is fine", () => {
		expect(blockersFirst([])).toEqual({ ok: true, items: [] });
	});

	test("a cycle is an error that names the items in it", () => {
		const result = blockersFirst([
			item("free"),
			item("1", ["2"]),
			item("2", ["3"]),
			item("3", ["1"]),
			item("after", ["1"]),
		]);
		expect(result).toEqual({ ok: false, cycle: ["1", "2", "3"] });
	});

	test("a cycle of two", () => {
		expect(blockersFirst([item("a", ["b"]), item("b", ["a"])])).toEqual({
			ok: false,
			cycle: ["a", "b"],
		});
	});

	test("the cycle leaves out an item that only waits on it", () => {
		const result = blockersFirst([
			item("x", ["a"]),
			item("a", ["b"]),
			item("b", ["a"]),
		]);
		expect(result).toEqual({ ok: false, cycle: ["a", "b"] });
	});
});

describe("unfinishedBlockers", () => {
	test("names the blockers that are not done, listed or not", () => {
		const items = [
			item("1"),
			item("2", [], { done: true }),
			item("3"),
			item("4", [
				"1",
				"2",
				"3",
				{ id: "9", done: false },
				{ id: "8", done: true },
			]),
		];
		expect(unfinishedBlockers(nth(items, 3), items, { "3": "done" })).toEqual([
			"1",
			"9",
		]);
	});
});

describe("nextItem", () => {
	test("returns the first item without a state", () => {
		const items = [item("1"), item("2")];
		expect(nextItem(items, {})).toEqual({ kind: "item", item: nth(items, 0) });
		expect(nextItem(items, { "1": "done" })).toEqual({
			kind: "item",
			item: nth(items, 1),
		});
	});

	test("skips items done before the run", () => {
		const items = [item("1", [], { done: true }), item("2")];
		expect(nextItem(items, {})).toEqual({ kind: "item", item: nth(items, 1) });
	});

	test("an item waits until its blocker is done in this visit", () => {
		const items = ordered([item("1"), item("2", ["1"])]);
		expect(nextItem(items, { "1": "running" })).toEqual({
			kind: "waiting",
			items: [nth(items, 1)],
		});
		expect(nextItem(items, { "1": "done" })).toEqual({
			kind: "item",
			item: nth(items, 1),
		});
	});

	test("a blocker done before the run counts as done", () => {
		const items = ordered([item("1", [], { done: true }), item("2", ["1"])]);
		expect(nextItem(items, {})).toEqual({ kind: "item", item: nth(items, 1) });
	});

	test("a listed blocker counts by the listed item, not the link", () => {
		const items = ordered([
			item("1", [], { done: true }),
			item("2", [{ id: "1", done: false }]),
		]);
		expect(nextItem(items, {})).toEqual({ kind: "item", item: nth(items, 1) });
	});

	test("a blocker outside the list counts by its done flag", () => {
		const open = [item("1", [{ id: "99", done: false }])];
		expect(nextItem(open, {})).toEqual({ kind: "waiting", items: open });
		const closed = [item("1", [{ id: "99", done: true }])];
		expect(nextItem(closed, {})).toEqual({
			kind: "item",
			item: nth(closed, 0),
		});
	});

	test("does not return an item whose blocker failed or is blocked", () => {
		const items = ordered([item("1"), item("2", ["1"]), item("3", ["2"])]);
		expect(nextItem(items, { "1": "failed" })).toEqual({ kind: "none" });
		expect(nextItem(items, { "1": "failed", "2": "blocked" })).toEqual({
			kind: "none",
		});
	});

	test("goes on with free items after a failure", () => {
		const items = ordered([item("1"), item("2", ["1"]), item("3")]);
		const states: Record<string, ItemState> = { "1": "failed", "2": "blocked" };
		expect(nextItem(items, states)).toEqual({
			kind: "item",
			item: nth(items, 2),
		});
	});

	test("none when every item is done or has a state", () => {
		const items = [item("1"), item("2", [], { done: true })];
		expect(nextItem(items, { "1": "halted" })).toEqual({ kind: "none" });
		expect(nextItem([], {})).toEqual({ kind: "none" });
	});
});

describe("newlyBlocked", () => {
	test("items whose blocker failed, transitively", () => {
		const items = ordered([
			item("1"),
			item("2", ["1"]),
			item("3", ["2"]),
			item("4"),
		]);
		expect(newlyBlocked(items, { "1": "failed" })).toEqual([
			{ item: nth(items, 1), blocker: "1" },
			{ item: nth(items, 2), blocker: "2" },
		]);
	});

	test("a blocked blocker blocks too", () => {
		const items = ordered([item("2"), item("3", ["2"])]);
		expect(newlyBlocked(items, { "2": "blocked" })).toEqual([
			{ item: nth(items, 1), blocker: "2" },
		]);
	});

	test("does not depend on the order of the list", () => {
		const items = [item("3", ["2"]), item("2", ["1"]), item("1")];
		expect(
			newlyBlocked(items, { "1": "failed" }).map((entry) => entry.item.id),
		).toEqual(["2", "3"]);
	});

	test("leaves out items with a state and items done before the run", () => {
		const items = ordered([
			item("1"),
			item("2", ["1"]),
			item("3", ["1"], { done: true }),
		]);
		expect(newlyBlocked(items, { "1": "failed", "2": "blocked" })).toEqual([]);
	});

	test("running, halted and done blockers block nothing", () => {
		const items = ordered([item("1"), item("2", ["1"])]);
		for (const state of ["running", "halted", "done"] as const) {
			expect(newlyBlocked(items, { "1": state })).toEqual([]);
		}
	});
});

describe("normalizeList", () => {
	const items = (value: Parameters<typeof normalizeList>[0]) => {
		const result = normalizeList(value);
		if (!result.ok) throw new Error(result.error);
		return result.items;
	};

	test("an object element gives id, title, url, dependsOn and done", () => {
		const element = {
			id: "login",
			title: "Add login",
			url: "https://example.com/1",
			dependsOn: ["setup", { id: "db", done: false }, { id: "ci", done: true }],
			done: false,
			extra: { kept: [1, 2] },
		};
		expect(items([element])).toEqual([
			{
				id: "login",
				title: "Add login",
				url: "https://example.com/1",
				value: element,
				dependsOn: [
					{ id: "setup", done: true },
					{ id: "db", done: false },
					{ id: "ci", done: true },
				],
				done: false,
			},
		]);
	});

	test("ids may be numbers; name stands in for id and title", () => {
		expect(
			items([
				{ id: 12, title: "Twelve" },
				{ name: "lint" },
				{ name: 7, title: "Seven" },
			]).map((entry) => [entry.id, entry.title]),
		).toEqual([
			["12", "Twelve"],
			["lint", "lint"],
			["7", "Seven"],
		]);
	});

	test("without id or name, the id is the position", () => {
		expect(
			items([{ title: "a" }, { title: "b" }]).map((entry) => entry.id),
		).toEqual(["0", "1"]);
	});

	test("blockedBy is read like dependsOn", () => {
		expect(
			items([{ id: "2", blockedBy: [1, { id: "3", done: false }] }])[0]
				?.dependsOn,
		).toEqual([
			{ id: "1", done: true },
			{ id: "3", done: false },
		]);
	});

	test("dependency entries without an id are left out", () => {
		expect(
			items([{ id: "a", dependsOn: [null, true, "", { done: true }, "b"] }])[0]
				?.dependsOn,
		).toEqual([{ id: "b", done: true }]);
	});

	test("done is true only for true", () => {
		expect(
			items([
				{ id: "a", done: true },
				{ id: "b", done: "yes" },
				{ id: "c" },
			]).map((entry) => entry.done),
		).toEqual([true, false, false]);
	});

	test("an element that is not an object keeps its value; title is short text", () => {
		const long = "x".repeat(100);
		expect(items(["src/a.ts", 42, [1, 2], null, long])).toEqual([
			{
				id: "0",
				title: "src/a.ts",
				url: null,
				value: "src/a.ts",
				dependsOn: [],
				done: false,
			},
			{
				id: "1",
				title: "42",
				url: null,
				value: 42,
				dependsOn: [],
				done: false,
			},
			{
				id: "2",
				title: "[1,2]",
				url: null,
				value: [1, 2],
				dependsOn: [],
				done: false,
			},
			{
				id: "3",
				title: "null",
				url: null,
				value: null,
				dependsOn: [],
				done: false,
			},
			{
				id: "4",
				title: `${"x".repeat(59)}…`,
				url: null,
				value: long,
				dependsOn: [],
				done: false,
			},
		]);
	});

	test("an object without title or name gets a short text of itself", () => {
		expect(items([{ id: "a", path: "src/a.ts" }])[0]?.title).toBe(
			'{"id":"a","path":"src/a.ts"}',
		);
	});

	test("a url that is not a string is null", () => {
		expect(items([{ id: "a", url: 5 }])[0]?.url).toBeNull();
	});

	test("an empty array is an empty list", () => {
		expect(normalizeList([])).toEqual({ ok: true, items: [] });
	});

	test("a value that is not an array is an error", () => {
		for (const value of [{ tasks: [] }, "[]", null, 3]) {
			const result = normalizeList(value);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error).toContain("not a JSON array");
		}
	});

	test("duplicate ids are an error that names the id", () => {
		expect(normalizeList([{ id: "a" }, { name: "a" }])).toEqual({
			ok: false,
			error: 'The list has the id "a" more than once (item 2).',
		});
		expect(normalizeList([{ id: 1 }, { id: "1" }]).ok).toBe(false);
	});

	test("normalized items order blockers first", () => {
		const list = items([{ id: "b", dependsOn: ["a"] }, { id: "a" }]);
		expect(ids(ordered(list))).toEqual(["a", "b"]);
		// "a" is in the list and not done: "b" waits for it.
		expect(nextItem(ordered(list), {})).toMatchObject({
			kind: "item",
			item: { id: "a" },
		});
		expect(nextItem(ordered(list), { a: "running" })).toMatchObject({
			kind: "waiting",
		});
	});

	test("a plain dependency outside the list counts as done", () => {
		const list = items([{ id: "b", dependsOn: ["gone"] }]);
		expect(nextItem(list, {})).toMatchObject({
			kind: "item",
			item: { id: "b" },
		});
	});
});
