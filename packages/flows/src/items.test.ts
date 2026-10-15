import { describe, expect, test } from "bun:test";
import { blockersFirst, type ItemState, newlyBlocked, nextItem } from "./items";
import type { SourceItem } from "./types";

/** An item blocked by the given ids; a blocker counts as not done. */
function item(
	id: string,
	blockedBy: (string | { id: string; done: boolean })[] = [],
	extra: Partial<SourceItem> = {},
): SourceItem {
	return {
		id,
		title: `Item ${id}`,
		blockedBy: blockedBy.map((entry) =>
			typeof entry === "string" ? { id: entry, done: false } : entry,
		),
		done: false,
		...extra,
	};
}

function nth(list: readonly SourceItem[], index: number): SourceItem {
	const found = list[index];
	if (found === undefined) throw new Error(`no item at ${index}`);
	return found;
}

const ids = (items: readonly SourceItem[]) => items.map((entry) => entry.id);

function ordered(items: SourceItem[]): SourceItem[] {
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
