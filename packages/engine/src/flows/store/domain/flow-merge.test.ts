import { describe, expect, test } from "bun:test";
import { mergedSchedule, sameFlow, withPerson } from "./flow-merge";

describe("a merge of flow documents", () => {
	test("a schedule follows its flow's new name and its Person's id, and drops a Device", () => {
		expect(
			mergedSchedule(
				{ id: "s", flow: "build", person: "ada", device: "laptop" },
				{ build: "build-2" },
				{ ada: "ada-there" },
			),
		).toEqual({ id: "s", flow: "build-2", person: "ada-there" });
		expect(mergedSchedule("odd", {}, {})).toBe("odd");
	});

	test("a Person not in the map stays", () => {
		expect(withPerson({ personId: "bo" }, "personId", { ada: "x" })).toEqual({
			personId: "bo",
		});
	});

	test("the same flow reads on both sides with the same content", () => {
		expect(sameFlow({ json: { a: 1 } }, { json: { a: 1 } })).toBe(true);
		expect(sameFlow({ json: { a: 1 } }, { json: { a: 2 } })).toBe(false);
		expect(sameFlow(undefined, { json: {} })).toBe(false);
	});
});
