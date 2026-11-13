import { describe, expect, test } from "bun:test";
import { AGENT_ENTRIES, agentEntryIds, entryOpening } from "./builtin";

describe("the first message of an entry", () => {
	test("a way to save names the step that cost most", () => {
		expect(
			entryOpening("spend.saving", {
				saving: { kind: "costly", step: "build" },
			}),
		).toContain("the step build");
		expect(
			entryOpening("spend.saving", { saving: { kind: "costly" } }),
		).not.toContain("the step");
	});

	test("each way to save asks its own question", () => {
		const asks = (["unfinished", "nothing", "costly"] as const).map((kind) =>
			entryOpening("spend.saving", { saving: { kind } }),
		);
		expect(new Set(asks).size).toBe(3);
		expect(asks).not.toContain(null);
	});

	test("an entry without one leaves the first message to the person", () => {
		expect(entryOpening("spend.saving")).toBeNull();
		expect(entryOpening("flow.build")).toBeNull();
		expect(entryOpening("flow.improve")).toBeNull();
		expect(entryOpening("run.improve")).toContain("this run");
	});

	test("every entry names its agent and the words of its button", () => {
		for (const id of agentEntryIds) {
			expect(AGENT_ENTRIES[id].label).not.toBe("");
		}
		expect(new Set(agentEntryIds.map((id) => AGENT_ENTRIES[id].label))).toEqual(
			new Set([
				"Ask why",
				"Improve this flow",
				"Build with an agent",
				"Suggest",
			]),
		);
	});
});
