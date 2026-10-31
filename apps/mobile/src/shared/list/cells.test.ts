import { describe, expect, test } from "bun:test";

import { cellsOf } from "./cells";

describe("cellsOf", () => {
	test("the first row starts the card and the last ends it", () => {
		expect(cellsOf(["a", "b", "c"])).toEqual([
			{ item: "a", first: true, last: false },
			{ item: "b", first: false, last: false },
			{ item: "c", first: false, last: true },
		]);
	});

	test("one row is the whole card", () => {
		expect(cellsOf(["a"])).toEqual([{ item: "a", first: true, last: true }]);
	});

	test("no rows, no cells", () => {
		expect(cellsOf([])).toEqual([]);
	});
});
