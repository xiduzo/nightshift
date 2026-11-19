import { expect, test } from "bun:test";
import {
	SCHEDULER_LOCK,
	savedValues,
	settingsView,
	USAGE_LOCK,
} from "./setting-fields";

test("the words of the two locks", () => {
	expect(SCHEDULER_LOCK).toBe(
		"Night Shift was started with schedules turned off. You cannot turn them on here. To turn them on, start Night Shift again with schedules on.",
	);
	expect(USAGE_LOCK).toBe(
		"Night Shift was started with anonymous usage turned off. You cannot turn it on here. Start Night Shift again with usage on.",
	);
});

test("saved values leave out unknown keys and values that no longer parse", () => {
	const values = savedValues([
		["retiredSetting", true],
		["constructor", {}],
		["maxConcurrentRuns", "five"],
		["agentModel", "opus"],
	]);
	expect([...values]).toEqual([["agentModel", "opus"]]);
});

test("the embedding model falls back to the default the ground gives", () => {
	const view = settingsView(new Map(), {
		env: {},
		embeddingModel: "embed:1",
	});
	expect(view.values.embeddingModel).toBe("embed:1");
	expect(view.fields.embeddingModel).toEqual({
		source: "default",
		default: "embed:1",
		env: "NIGHTSHIFT_EMBEDDING_MODEL",
	});
});
