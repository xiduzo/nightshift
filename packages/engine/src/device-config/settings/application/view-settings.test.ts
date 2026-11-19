import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySavedSettings } from "../adapters/out/in-memory-saved-settings";
import type { SettingKey } from "../domain/setting-defs";
import { SCHEDULER_LOCK, USAGE_LOCK } from "../domain/setting-fields";
import { viewSettings } from "./view-settings";

/** The view of a computer with these saved values and this environment. */
function view(
	saved: [SettingKey, unknown][] = [],
	env: Record<string, string | undefined> = {},
) {
	return viewSettings({
		saved: inMemorySavedSettings(saved),
		ground: { env, embeddingModel: "embed:1" },
	})(NIGHT_SHIFT);
}

describe("precedence", () => {
	test("with nothing saved and no environment, every setting is its default", () => {
		const { values, fields } = view();
		expect(values.maxConcurrentRuns).toBe(2);
		expect(values.scheduler).toBe(true);
		expect(values.claudeBin).toBe("claude");
		expect(fields.maxConcurrentRuns).toEqual({
			source: "default",
			default: 2,
			env: "NIGHTSHIFT_MAX_CONCURRENT_RUNS",
		});
		// A setting with no environment variable says so by leaving `env` out.
		expect(fields.networkGraceMinutes).toEqual({
			source: "default",
			default: 240,
		});
	});

	test("the environment beats the default, and a saved value beats both", () => {
		const env = { NIGHTSHIFT_MAX_CONCURRENT_RUNS: " 4 " };
		expect(view([], env).values.maxConcurrentRuns).toBe(4);
		expect(view([], env).fields.maxConcurrentRuns).toEqual({
			source: "env",
			default: 2,
			env: "NIGHTSHIFT_MAX_CONCURRENT_RUNS",
			envValue: 4,
		});
		const saved = view([["maxConcurrentRuns", 6]], env);
		expect(saved.values.maxConcurrentRuns).toBe(6);
		expect(saved.fields.maxConcurrentRuns).toEqual({
			source: "saved",
			default: 2,
			env: "NIGHTSHIFT_MAX_CONCURRENT_RUNS",
			envValue: 4,
		});
	});

	test("an invalid environment value is ignored", () => {
		const { values, fields } = view([], {
			NIGHTSHIFT_MAX_CONCURRENT_RUNS: "17",
		});
		expect(values.maxConcurrentRuns).toBe(2);
		expect(fields.maxConcurrentRuns.source).toBe("default");
		expect(fields.maxConcurrentRuns.envValue).toBeUndefined();
	});
});

describe("Ollama", () => {
	test("the default embedding model is the one the ground gives", () => {
		const { values, fields } = view();
		expect(values.embeddingModel).toBe("embed:1");
		expect(fields.embeddingModel.default).toBe("embed:1");
	});

	test("NIGHTSHIFT_EMBEDDING_MODEL picks the model, a saved one wins", () => {
		const env = { NIGHTSHIFT_EMBEDDING_MODEL: "nomic-embed-text" };
		expect(view([], env).values.embeddingModel).toBe("nomic-embed-text");
		expect(
			view([["embeddingModel", "bge-m3"]], env).values.embeddingModel,
		).toBe("bge-m3");
	});
});

describe("the scheduler switch", () => {
	test("NIGHTSHIFT_SCHEDULER=off locks the scheduler off, even over a saved true", () => {
		const { values, fields } = view([["scheduler", true]], {
			NIGHTSHIFT_SCHEDULER: "OFF",
		});
		expect(values.scheduler).toBe(false);
		expect(fields.scheduler.source).toBe("env");
		expect(fields.scheduler.locked).toBe(SCHEDULER_LOCK);
	});
});

describe("anonymous usage", () => {
	test.each([
		["DO_NOT_TRACK", "1"],
		["OTEL_SDK_DISABLED", "true"],
		["NIGHTSHIFT_USAGE", "off"],
	])("%s=%s locks usage off, even over a saved true", (name, value) => {
		const { values, fields } = view([["usage", true]], { [name]: value });
		expect(values.usage).toBe(false);
		expect(fields.usage.locked).toBe(USAGE_LOCK);
	});
});

describe("load", () => {
	test("reads only what the saved settings give", () => {
		const { values, fields } = view([["agentModel", "opus"]]);
		expect(values.agentModel).toBe("opus");
		expect(fields.agentModel.source).toBe("saved");
		expect(fields.maxConcurrentRuns.source).toBe("default");
	});
});
