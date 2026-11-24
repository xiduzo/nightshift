import { describe, expect, test } from "bun:test";
import { DEFAULT_POLICY } from "@nightshift/flows";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../../access/computer/adapters/out/in-memory-computer";
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
		computerAccess: inMemoryComputer(),
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

	test.each([
		["NIGHTSHIFT_MAX_CONCURRENT_RUNS", "abc"],
		["NIGHTSHIFT_MAX_CONCURRENT_RUNS", "0"],
		["NIGHTSHIFT_MAX_CONCURRENT_RUNS", "2.5"],
		["NIGHTSHIFT_MAX_CONCURRENT_RUNS", "17"],
		["NIGHTSHIFT_MAX_CONCURRENT_RUNS", ""],
		["NIGHTSHIFT_MAX_STEPS_PER_RUN", "-1"],
		["NIGHTSHIFT_CODEX_BIN", "   "],
		["NIGHTSHIFT_RESUME_INTERRUPTED_RUNS", "maybe"],
	])("an invalid %s=%p is ignored", (name, raw) => {
		const { values, fields } = view([], { [name]: raw });
		expect(values.maxConcurrentRuns).toBe(2);
		expect(values.maxStepsPerRun).toBe(500);
		expect(values.codexBin).toBe("codex");
		expect(values.resumeInterruptedRuns).toBe(true);
		for (const field of [
			fields.maxConcurrentRuns,
			fields.maxStepsPerRun,
			fields.codexBin,
			fields.resumeInterruptedRuns,
		]) {
			expect(field.source).toBe("default");
			expect(field.envValue).toBeUndefined();
		}
	});

	test("the run policy settings fall back to the flow's built-in policy", () => {
		const { fields } = view();
		expect({
			usageLimitFirstWaitMinutes: fields.usageLimitFirstWaitMinutes.default,
			usageLimitMaxWaitMinutes: fields.usageLimitMaxWaitMinutes.default,
			networkGraceMinutes: fields.networkGraceMinutes.default,
			maxSteps: fields.maxStepsPerRun.default,
			resumeInterruptedRuns: fields.resumeInterruptedRuns.default,
			budgetUsd: fields.budgetUsd.default,
			maxTurns: fields.maxTurns.default,
			idleMinutes: fields.idleMinutes.default,
		}).toEqual(DEFAULT_POLICY);
	});

	test("a text value loses its spaces, and a switch reads on and off in any case", () => {
		const { values } = view([], {
			NIGHTSHIFT_CLAUDE_BIN: "  /opt/claude  ",
			NIGHTSHIFT_RESUME_INTERRUPTED_RUNS: " Off ",
		});
		expect(values.claudeBin).toBe("/opt/claude");
		expect(values.resumeInterruptedRuns).toBe(false);
	});
});

describe("Ollama", () => {
	test("the default embedding model is the one the ground gives", () => {
		const { values, fields } = view();
		expect(values.embeddingModel).toBe("embed:1");
		expect(fields.embeddingModel.default).toBe("embed:1");
	});

	test.each([
		["studio.local", "http://studio.local:11434"],
		["studio.local:11500", "http://studio.local:11500"],
		["0.0.0.0", "http://0.0.0.0:11434"],
		["http://studio.local", "http://studio.local:11434"],
		["https://gpu.example.com/ollama/", "https://gpu.example.com/ollama"],
		["http://studio.local:80", "http://studio.local"],
	])("OLLAMA_HOST=%p is the address %p", (raw, address) => {
		const { values, fields } = view([], { OLLAMA_HOST: raw });
		expect(values.ollamaAddress).toBe(address);
		expect(fields.ollamaAddress.source).toBe("env");
	});

	test("a saved address wins over OLLAMA_HOST, and none is this computer's", () => {
		expect(view().values.ollamaAddress).toBe("");
		expect(
			view([["ollamaAddress", "https://gpu.example.com"]], {
				OLLAMA_HOST: "studio.local",
			}).values.ollamaAddress,
		).toBe("https://gpu.example.com");
	});

	test.each([
		["off", "off"],
		["false", "off"],
		["on", "on"],
		["auto", "auto"],
		["maybe", "auto"],
	])("NIGHTSHIFT_OLLAMA=%p is %p", (raw, mode) => {
		expect(view([], { NIGHTSHIFT_OLLAMA: raw }).values.ollama).toBe(
			mode as "auto",
		);
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
			NIGHTSHIFT_SCHEDULER: " OFF ",
		});
		expect(values.scheduler).toBe(false);
		expect(fields.scheduler.source).toBe("env");
		expect(fields.scheduler.envValue).toBe(false);
		expect(fields.scheduler.locked).toBe(SCHEDULER_LOCK);
	});

	test("any other NIGHTSHIFT_SCHEDULER value leaves it on, and a saved false wins", () => {
		const env = { NIGHTSHIFT_SCHEDULER: "on" };
		const on = view([], env);
		expect(on.values.scheduler).toBe(true);
		expect(on.fields.scheduler).toMatchObject({
			source: "env",
			envValue: true,
		});
		expect(on.fields.scheduler.locked).toBeUndefined();
		const off = view([["scheduler", false]], env);
		expect(off.values.scheduler).toBe(false);
		expect(off.fields.scheduler.source).toBe("saved");
	});
});

describe("anonymous usage", () => {
	test("on by default, and the notice is unseen; a switch that is on is not locked", () => {
		const { values, fields } = view();
		expect([values.usage, values.usageSeen]).toEqual([true, false]);
		expect(fields.usage).toMatchObject({
			source: "default",
			default: true,
			env: "NIGHTSHIFT_USAGE",
		});
		const open = view([["usage", false]], { NIGHTSHIFT_USAGE: "on" });
		expect(open.values.usage).toBe(false);
		expect(open.fields.usage.locked).toBeUndefined();
	});

	test.each([
		["DO_NOT_TRACK", "1"],
		["DO_NOT_TRACK", " 1 "],
		["OTEL_SDK_DISABLED", "true"],
		["OTEL_SDK_DISABLED", "TRUE"],
		["NIGHTSHIFT_USAGE", "off"],
		["NIGHTSHIFT_USAGE", "OFF"],
	])("%s=%s locks usage off, even over a saved true", (name, value) => {
		const { values, fields } = view([["usage", true]], { [name]: value });
		expect(values.usage).toBe(false);
		expect(fields.usage.source).toBe("env");
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

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = viewSettings({ computerAccess } as never);
	expect(await computerAccess.whoMay((actor) => act(actor))).toEqual(
		ONLY_THE_OWNER,
	);
});
