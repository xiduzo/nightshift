import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT, personOf } from "./actor";

describe("the actor", () => {
	test("a Person's actor names them, through any door", () => {
		expect(personOf({ personId: "person-ada" })).toBe("person-ada");
		expect(personOf({ personId: "person-ada", door: "command" })).toBe(
			"person-ada",
		);
	});

	test("Night Shift names no Person", () => {
		expect(personOf(NIGHT_SHIFT)).toBeNull();
	});
});
