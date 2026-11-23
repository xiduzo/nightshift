import { describe, expect, test } from "bun:test";
import { personalBound, projectBound, spaceBound } from "./kept-secret";

describe("what a kept value is bound to", () => {
	test("a Personal value: its owner and its name", () => {
		expect(personalBound("person-ada", "TOKEN")).toBe("person-ada\nTOKEN");
	});

	test("a Project value never binds as a Personal or a Space one", () => {
		expect(projectBound("p1", "TOKEN")).toBe("project:p1\nTOKEN");
		expect(spaceBound("p1", "TOKEN")).toBe("space:p1\nTOKEN");
		expect(personalBound("p1", "TOKEN")).not.toBe(projectBound("p1", "TOKEN"));
	});
});
