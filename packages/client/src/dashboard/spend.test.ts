import { describe, expect, test } from "bun:test";
import { savingAsk, savingKindOf } from "./spend";

describe("the ask of a way to save", () => {
	test("names the step that cost most", () => {
		expect(savingAsk({ kind: "costly", step: "build" })).toContain(
			"the step build",
		);
		expect(savingAsk({ kind: "costly" })).not.toContain("the step");
	});

	test("each kind asks its own question", () => {
		const asks = (["unfinished", "nothing", "costly"] as const).map((kind) =>
			savingAsk({ kind }),
		);
		expect(new Set(asks).size).toBe(3);
	});

	test("reads a kind from text", () => {
		expect(savingKindOf("nothing")).toBe("nothing");
		expect(savingKindOf("toString")).toBeUndefined();
		expect(savingKindOf("")).toBeUndefined();
	});
});
