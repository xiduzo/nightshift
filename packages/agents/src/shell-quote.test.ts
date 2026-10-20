import { describe, expect, test } from "bun:test";
import { shellQuote, shellQuoteAlways } from "./shell-quote";

describe("shell quoting", () => {
	test("shellQuote leaves a safe word as it is", () => {
		expect(shellQuote("abc-123")).toBe("abc-123");
		expect(shellQuote("/work/tree")).toBe("/work/tree");
	});

	test("shellQuote quotes a value that needs it", () => {
		expect(shellQuote("it's here")).toBe(`'it'\\''s here'`);
		expect(shellQuote("")).toBe("''");
	});

	test("shellQuoteAlways quotes every value", () => {
		expect(shellQuoteAlways("codex")).toBe("'codex'");
		expect(shellQuoteAlways("it's")).toBe(`'it'\\''s'`);
	});
});
