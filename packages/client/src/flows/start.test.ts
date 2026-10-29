import { describe, expect, test } from "bun:test";

import { canStart } from "./start";

describe("canStart", () => {
	test("a flow that loads without errors can start", () => {
		expect(canStart({ nodeCount: 4, errorCount: 0 })).toBe(true);
	});

	test("a flow that does not load cannot start", () => {
		expect(canStart({ nodeCount: null, errorCount: 0 })).toBe(false);
	});

	test("a flow with errors cannot start", () => {
		expect(canStart({ nodeCount: 4, errorCount: 2 })).toBe(false);
	});
});
