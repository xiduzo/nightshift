import { describe, expect, test } from "bun:test";
import { createPlacement } from "./create-placement";

describe("createPlacement", () => {
	test("exports the factory", () => {
		expect(typeof createPlacement).toBe("function");
	});
});
