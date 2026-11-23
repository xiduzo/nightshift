import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryEditedSettings } from "../adapters/out/in-memory-neighbours";
import { addHarness } from "./add-harness";

describe("addHarness", () => {
	test("adds a harness once", async () => {
		const settings = inMemoryEditedSettings({ harnesses: ["claude-code"] });
		const add = addHarness({ settings });
		await add(NIGHT_SHIFT, { harness: "gemini" });
		await add(NIGHT_SHIFT, { harness: "gemini" });
		expect(settings.current().harnesses).toEqual(["claude-code", "gemini"]);
		expect(settings.saves).toHaveLength(1);
	});
});
