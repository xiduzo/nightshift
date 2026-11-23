import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryEditedSettings } from "../adapters/out/in-memory-neighbours";
import { saveCustomAgent } from "./save-custom-agent";

const goose = {
	slug: "goose",
	label: "Goose",
	command: "goose",
	args: ["acp"],
	env: {},
};

describe("saveCustomAgent", () => {
	test("adds an agent, refuses a taken slug or a removed agent, and keeps the slug on a change", async () => {
		const settings = inMemoryEditedSettings();
		const save = saveCustomAgent({ settings });
		await save(NIGHT_SHIFT, { agent: goose });
		await expect(save(NIGHT_SHIFT, { agent: goose })).rejects.toThrow(
			"A custom agent named acp:goose already exists. Pick another name.",
		);
		await expect(
			save(NIGHT_SHIFT, { agent: goose, previousSlug: "gone" }),
		).rejects.toThrow("This custom agent was removed. Add it again.");
		const saved = await save(NIGHT_SHIFT, {
			agent: { ...goose, slug: "other", label: "Goose 2" },
			previousSlug: "goose",
		});
		expect(saved).toEqual({ ...goose, label: "Goose 2" });
		expect(settings.current().customAgents).toEqual([saved]);
	});
});
