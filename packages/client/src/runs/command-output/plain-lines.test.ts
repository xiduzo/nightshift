import { describe, expect, test } from "bun:test";

import { durationMs, headAndTail, plainLines, stripAnsi } from "./plain-lines";

describe("plain lines", () => {
	test("terminal escapes go: colours, cursor moves and links", () => {
		expect(stripAnsi("\u001b[1m\u001b[32m✓\u001b[0m done\u001b[2K")).toBe(
			"✓ done",
		);
		expect(
			stripAnsi("\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007"),
		).toBe("link");
		expect(stripAnsi("no escapes")).toBe("no escapes");
	});

	test("a redrawn line keeps its last state, CRLF is LF", () => {
		expect(
			plainLines("10%\r50%\r100%\nnext\r\n", { head: 100, tail: 100 }),
		).toEqual(["100%", "next", ""]);
	});

	test("a task runner's prefix goes when most lines have it", () => {
		const turbo = [
			"@shop/web:test: bun test v1.3.10",
			"@shop/web:test: ",
			"@shop/web:test: src/a.test.ts:",
			"@shop/web:test: (pass) a > one [0.10ms]",
		].join("\n");
		expect(plainLines(turbo, { head: 1000, tail: 1000 })).toEqual([
			"bun test v1.3.10",
			"",
			"src/a.test.ts:",
			"(pass) a > one [0.10ms]",
		]);
		const pytest =
			"tests/test_a.py:12: AssertionError\nE   assert 1 == 2\nFAILED tests/test_a.py::test_a\n";
		expect(plainLines(pytest, { head: 1000, tail: 1000 })[0]).toBe(
			"tests/test_a.py:12: AssertionError",
		);
	});

	test("a long text keeps its head and tail, cut at line breaks", () => {
		const text = ["first", "x".repeat(50), "y".repeat(50), "last"].join("\n");
		expect(headAndTail(text, { head: 10, tail: 10 })).toBe("first\nlast");
		expect(headAndTail("short", { head: 10, tail: 10 })).toBe("short");
	});
});

describe("durations", () => {
	test("reads the ways runners print them", () => {
		expect(durationMs("12ms")).toBe(12);
		expect(durationMs("1.5s")).toBe(1500);
		expect(durationMs("2.345 s")).toBe(2345);
		expect(durationMs("0.012s")).toBe(12);
		expect(durationMs("1m 4s")).toBe(64_000);
		expect(durationMs("3 sec")).toBe(3000);
		expect(durationMs("1h 2m")).toBe(3_720_000);
	});

	test("a bare number or a word is no duration", () => {
		expect(durationMs("12")).toBeUndefined();
		expect(durationMs("soon")).toBeUndefined();
		expect(durationMs("")).toBeUndefined();
	});
});
