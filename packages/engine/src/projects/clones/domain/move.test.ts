import { describe, expect, test } from "bun:test";
import { NO_SUCH_SPACE } from "./move";

describe("a move of a project", () => {
	test("to a Space this Replica does not have says so", () => {
		expect(NO_SUCH_SPACE).toBe("That Space does not exist.");
	});
});
