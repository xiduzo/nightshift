import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { RunNotFound, SpaceNotFound } from "./refusals";

describe("the refusals of access", () => {
	test("a run that is not here is not found, in the words of the run log", () => {
		const refusal = new RunNotFound();
		expect(refusal).toBeInstanceOf(Refusal);
		expect(refusal.kind).toBe("not-found");
		expect(refusal.message).toBe("Night Shift cannot find this run.");
	});

	test("a Space the Person is not a Member of is not found", () => {
		const refusal = new SpaceNotFound();
		expect(refusal).toBeInstanceOf(Refusal);
		expect(refusal.kind).toBe("not-found");
		expect(refusal.message).toBe("That Space does not exist.");
	});
});
