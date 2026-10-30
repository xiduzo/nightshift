import { describe, expect, test } from "bun:test";

import { leadingIndent } from "./leading-indent";

describe("leadingIndent", () => {
	test("counts leading spaces", () => {
		expect(leadingIndent("    return x;")).toBe(4);
	});

	test("takes a tab to the next tab stop", () => {
		expect(leadingIndent("\treturn x;")).toBe(8);
		expect(leadingIndent("\t\tx")).toBe(16);
		expect(leadingIndent("  \tx")).toBe(8);
		expect(leadingIndent("\t  x")).toBe(10);
	});

	test("gives no indent to a line without one", () => {
		expect(leadingIndent("return x;")).toBe(0);
		expect(leadingIndent("")).toBe(0);
	});

	test("gives no indent to a line of only whitespace", () => {
		expect(leadingIndent("    ")).toBe(0);
		expect(leadingIndent("\t")).toBe(0);
	});
});
