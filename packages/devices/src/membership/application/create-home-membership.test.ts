import { describe, expect, test } from "bun:test";
import { createHomeMembership } from "./create-home-membership";

describe("createHomeMembership", () => {
	test("exports the factory", () => {
		expect(typeof createHomeMembership).toBe("function");
	});
});
