import { expect, test } from "bun:test";

import { isRecord } from ".";

test("a JSON object is a record, also an empty one", () => {
	expect([{}, { a: 1 }].map(isRecord)).toEqual([true, true]);
});

test("null, a list and any other value are not", () => {
	expect(
		[null, undefined, [], [{ a: 1 }], "text", 1, true].some(isRecord),
	).toBe(false);
});
