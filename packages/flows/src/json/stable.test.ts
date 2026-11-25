import { expect, test } from "bun:test";

import { stableJson } from ".";

test("one text whatever the order of the keys, at every depth", () => {
	const text = '{"a":[{"x":1,"y":null}],"b":{"c":2,"d":3}}';
	expect(stableJson({ b: { d: 3, c: 2 }, a: [{ y: null, x: 1 }] })).toBe(text);
	expect(stableJson({ a: [{ x: 1, y: null }], b: { c: 2, d: 3 } })).toBe(text);
});

test("the order of a list counts, a key set to undefined does not", () => {
	expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]));
	expect(stableJson({ a: 1, b: undefined })).toBe(stableJson({ a: 1 }));
});

test("undefined has a text that no JSON value has", () => {
	expect(stableJson(undefined)).toBe("undefined");
	expect(stableJson("undefined")).toBe('"undefined"');
});
