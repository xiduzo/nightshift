import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySavedSettings } from "../adapters/out/in-memory-saved-settings";
import type { SettingKey, SettingsPatch } from "../domain/setting-defs";
import { FIRST_WAIT_TOO_LONG } from "../domain/settings-patch";
import { saveSettings } from "./save-settings";

/** A save over the in-memory saved settings, with this environment. */
function saving(
	initial: [SettingKey, unknown][] = [],
	env: Record<string, string | undefined> = {},
) {
	const saved = inMemorySavedSettings(initial);
	const save = saveSettings({
		computerAccess: inMemoryComputer(),
		saved,
		ground: { env, embeddingModel: "embed:1" },
	});
	return {
		saved,
		save: (patch: SettingsPatch) => save(NIGHT_SHIFT, patch),
	};
}

/** What the save throws, or null. */
async function refusalOf(work: Promise<unknown>): Promise<unknown> {
	try {
		await work;
	} catch (error) {
		return error;
	}
	return null;
}

describe("save", () => {
	test("a saved value lasts, and null forgets it", async () => {
		const env = { NIGHTSHIFT_MAX_STEPS_PER_RUN: "800" };
		const { saved, save } = saving([], env);
		await save({ maxStepsPerRun: 1000, agentModel: "opus" });
		expect(saved.read().get("maxStepsPerRun")).toBe(1000);

		const view = await save({ maxStepsPerRun: null });
		expect(view.values.maxStepsPerRun).toBe(800);
		expect(view.fields.maxStepsPerRun.source).toBe("env");
		// Keys the patch leaves out stay as they were.
		expect(view.values.agentModel).toBe("opus");
		expect(saved.writes.at(-1)).toEqual({
			set: [],
			forget: ["maxStepsPerRun"],
		});
	});

	test("custom agents are saved with their command, arguments and env", async () => {
		const { save } = saving();
		const goose = {
			slug: "goose",
			label: "Goose",
			command: "goose",
			args: ["acp"],
			env: { GOOSE_API_KEY: "${GOOSE_API_KEY}" },
		};
		const view = await save({ customAgents: [goose] });
		expect(view.values.customAgents).toEqual([goose]);
	});

	test("one save is one write, in the order of the settings", async () => {
		const { saved, save } = saving();
		await save({ agentModel: "opus", maxConcurrentRuns: 3 });
		expect(saved.writes).toEqual([
			{
				set: [
					["maxConcurrentRuns", 3],
					["agentModel", "opus"],
				],
				forget: [],
			},
		]);
	});

	test.each([
		["an unknown key", { nope: 1 }],
		["a run cap of 0", { maxConcurrentRuns: 0 }],
		["a run cap over 16", { maxConcurrentRuns: 17 }],
		["a fractional run cap", { maxConcurrentRuns: 1.5 }],
		["a negative wait", { networkGraceMinutes: -1 }],
		["a wait over a week", { networkGraceMinutes: 10_081 }],
		["an offline limit of 0", { offlineWorkMinutes: 0 }],
		["a blank binary", { codexBin: "  " }],
		["an unknown harness", { agentHarness: "aider" }],
		["an Ollama address without a scheme", { ollamaAddress: "studio.local" }],
		["an embedding model of two words", { embeddingModel: "two words" }],
		[
			"two custom agents with one slug",
			{
				customAgents: [
					{ slug: "goose", label: "Goose", command: "goose", args: ["acp"] },
					{ slug: "goose", label: "Goose 2", command: "goose2", args: [] },
				],
			},
		],
		[
			"a custom agent slug with capitals",
			{ customAgents: [{ slug: "Goose", label: "Goose", command: "goose" }] },
		],
		["a wrong type", { scheduler: "yes" }],
	])("refuses %s and saves nothing", async (_label, patch) => {
		const { saved, save } = saving();
		expect(await refusalOf(save(patch as SettingsPatch))).not.toBeNull();
		expect(saved.writes).toEqual([]);
	});

	test("refuses a first usage-limit wait longer than the longest one", async () => {
		const { saved, save } = saving();
		const refusal = await refusalOf(save({ usageLimitFirstWaitMinutes: 90 }));
		expect((refusal as Error).message).toBe(FIRST_WAIT_TOO_LONG);
		expect(saved.writes).toEqual([]);
		// Both at once is fine when they fit together.
		await save({
			usageLimitFirstWaitMinutes: 90,
			usageLimitMaxWaitMinutes: 120,
		});
		expect(saved.writes).toHaveLength(1);
	});

	test("forgetting the longest wait checks the first wait against the default it falls back to", async () => {
		const { save } = saving([
			["usageLimitFirstWaitMinutes", 80],
			["usageLimitMaxWaitMinutes", 100],
		]);
		const refusal = await refusalOf(save({ usageLimitMaxWaitMinutes: null }));
		expect((refusal as Error).message).toBe(FIRST_WAIT_TOO_LONG);
		const view = await save({
			usageLimitFirstWaitMinutes: null,
			usageLimitMaxWaitMinutes: null,
		});
		expect(view.values.usageLimitFirstWaitMinutes).toBe(5);
		expect(view.values.usageLimitMaxWaitMinutes).toBe(60);
	});
});

describe("anonymous usage", () => {
	test("saving the switch, on or off, marks the notice seen", async () => {
		const { saved, save } = saving();
		const view = await save({ usage: false });
		expect(view.values.usageSeen).toBe(true);
		expect(saved.writes).toEqual([
			{
				set: [
					["usage", false],
					["usageSeen", true],
				],
				forget: [],
			},
		]);
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = saveSettings({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
