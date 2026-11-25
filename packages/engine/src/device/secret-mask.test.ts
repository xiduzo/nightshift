import { describe, expect, test } from "bun:test";

import { secretMask } from "./secret-mask";

const VALUE = "ab/cd-fern";
const deep = (text: string, depth = 50_000) =>
	`${"[".repeat(depth)}${text}${"]".repeat(depth)}`;

describe("JSON of any depth", () => {
	const mask = secretMask([VALUE]);

	test("text without a value stays as it is", () => {
		expect(mask.jsonText(deep("1"))).toBe(deep("1"));
		expect(mask.jsonText(deep('"\\u0041"'))).toBe(deep('"\\u0041"'));
	});

	test("text with a value has it hidden, however it is written", () => {
		const hidden = deep('"•••"');
		expect(mask.jsonText(deep(`"${VALUE}"`))).toBe(hidden);
		expect(mask.jsonText(deep('"ab\\/cd-fern"'))).toBe(hidden);
		expect(mask.jsonText(deep('"\\u0061b/cd\\u002dfern"'))).toBe(hidden);
	});

	test("text with a value that is a document is hidden", () => {
		const out = secretMask(['{"user":"fern"}']).jsonText(
			deep('{ "user": "fern" }'),
		);
		expect(out).not.toContain("fern");
	});

	test("data has it hidden", () => {
		let data: unknown = JSON.parse(deep(`{"${VALUE}":["${VALUE}"]}`));
		data = mask.json(data);
		while (Array.isArray(data)) data = data[0];
		expect(data).toEqual({ "•••": ["•••"] });
	});

	test("a command's data and a tool's text pass the same way", () => {
		expect(mask.text(mask.jsonText(deep(`"${VALUE}"`)))).toBe(deep('"•••"'));
	});
});

describe("a value of the marks of JSON keeps the JSON valid", () => {
	const text = '{ "a": [1,2,"abcd",true,null], "b": {}, "c": [], "d": "" }';
	for (const value of [
		"{}",
		"[]",
		'""',
		'"',
		",",
		":",
		"{",
		"1,2",
		"true,null",
	]) {
		test(value, () => {
			const data = JSON.parse(secretMask([value]).jsonText(text));
			expect(Object.keys(data)).toEqual(["a", "b", "c", "d"]);
			expect(data.a.slice(0, 2)).toEqual([1, 2]);
		});
	}

	test("with its own quotes: the string goes, and so does the text of it", () => {
		const mask = secretMask(['"abcd"']);
		expect(JSON.parse(mask.jsonText(text)).a[2]).toBe("•••");
		expect(JSON.parse(mask.jsonText('{"a":"\\"abcd\\""}'))).toEqual({
			a: "•••",
		});
		expect(JSON.parse(mask.jsonText('{"abcd":"xabcd"}'))).toEqual({
			"•••": "xabcd",
		});
	});

	test("with the marks of an escape", () => {
		for (const value of ["\\", "\\n", "b", "\\new"]) {
			const out = secretMask([value]).jsonText('["a\\new","\\b","\\u00e9"]');
			expect(JSON.parse(out)[0]).toBe("a\new");
		}
	});

	test("in a string it is hidden as any value is", () => {
		expect(secretMask(["12:34"]).jsonText('{"a":"at 12:34"}')).toBe(
			'{"a":"at •••"}',
		);
	});
});

test("the names of an object keep their order, also a name that JavaScript treats apart", () => {
	const data = JSON.parse(
		`{"z":1,"__proto__":{"k":"${VALUE}"},"a":"${VALUE}"}`,
	);
	expect(JSON.stringify(secretMask([VALUE]).json(data))).toBe(
		'{"z":1,"__proto__":{"k":"•••"},"a":"•••"}',
	);
});

test("a large text is hidden in the time of one look at it, not one for each string", () => {
	const row = JSON.stringify({ id: 1, name: "row", tags: ["a", "b"] });
	const text = `[${`${row},`.repeat(60_000)}"${VALUE}"]`;
	const many = Array.from({ length: 52 }, (_, i) => `made-up-${i}`);
	const before = performance.now();
	expect(secretMask([...many, VALUE]).jsonText(text)).toContain("•••");
	expect(performance.now() - before).toBeLessThan(2_000);
});
