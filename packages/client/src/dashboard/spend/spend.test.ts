import { describe, expect, test } from "bun:test";
import { savingKindOf } from "./spend";

describe("the kind of a way to save", () => {
	test("reads a kind from text", () => {
		expect(savingKindOf("nothing")).toBe("nothing");
		expect(savingKindOf("toString")).toBeUndefined();
		expect(savingKindOf("")).toBeUndefined();
	});
});
