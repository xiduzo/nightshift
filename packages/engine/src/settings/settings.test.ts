import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setting } from "@nightshift/db/schema";
import type { DeviceDocument } from "../documents";
import { createSandbox, type Sandbox } from "../testing/test-support";
import {
	wireSettings as createSettingsStore,
	defaultRunSettings,
	effectiveDecider,
	reachesPrivateNetwork,
	withEffectiveDecider,
} from "./settings";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

/** A store over the Device document as a daemon start opens it. */
async function store(
	env: Record<string, string | undefined> = {},
	document?: DeviceDocument,
) {
	const s = createSettingsStore({
		document: document ?? (await sandbox.openDocument()),
		env,
	});
	await s.load();
	return s;
}

describe("the decider of new Decision nodes", () => {
	test("never saved: Ollama without a TypeSafe key, TypeSafe with one", async () => {
		const s = await store();
		// The store itself keeps the built-in default.
		expect(s.current().decisionDecider).toBe("typesafe");
		const withoutKey = withEffectiveDecider(s.view(), false);
		expect(withoutKey.values.decisionDecider).toBe("ollama");
		expect(withoutKey.fields.decisionDecider).toEqual({
			source: "default",
			default: "ollama",
		});
		expect(effectiveDecider(s.view(), false)).toBe("ollama");
		const withKey = withEffectiveDecider(s.view(), true);
		expect(withKey.values.decisionDecider).toBe("typesafe");
		expect(withKey.fields.decisionDecider.default).toBe("typesafe");
		// The other settings stay as they are.
		expect(withoutKey.values.maxConcurrentRuns).toBe(2);
	});

	test("a saved decider wins, with or without a key", async () => {
		const s = await store();
		await s.save({ decisionDecider: "openai" });
		expect(withEffectiveDecider(s.view(), false).values.decisionDecider).toBe(
			"openai",
		);
		expect(effectiveDecider(s.view(), true)).toBe("openai");
		await s.save({ decisionDecider: "typesafe" });
		expect(withEffectiveDecider(s.view(), false).values.decisionDecider).toBe(
			"typesafe",
		);
		await s.save({ decisionDecider: null });
		expect(withEffectiveDecider(s.view(), false).values.decisionDecider).toBe(
			"ollama",
		);
	});
});

describe("web requests to this network", () => {
	test("a computer that is not a Host always reaches its own network", async () => {
		const s = await store();
		expect(reachesPrivateNetwork(s.current())).toBe(true);
		await s.save({ webRequestsPrivateNetwork: false });
		expect(reachesPrivateNetwork(s.current())).toBe(true);
	});

	test("a Host reaches it only when its owner allows it", async () => {
		const s = await store();
		await s.save({ host: true });
		expect(reachesPrivateNetwork(s.current())).toBe(false);
		await s.save({ webRequestsPrivateNetwork: true });
		expect(reachesPrivateNetwork(s.current())).toBe(true);
	});
});

describe("save", () => {
	test("a saved value lasts across a reload, and null forgets it", async () => {
		const env = { NIGHTSHIFT_MAX_STEPS_PER_RUN: "800" };
		const first = await store(env);
		await first.save({ maxStepsPerRun: 1000, agentModel: "opus" });

		const second = await store(env);
		expect(second.current().maxStepsPerRun).toBe(1000);
		expect(second.current().agentModel).toBe("opus");

		const view = await second.save({ maxStepsPerRun: null });
		expect(view.values.maxStepsPerRun).toBe(800);
		expect(view.fields.maxStepsPerRun.source).toBe("env");
		// Keys the patch leaves out stay as they were.
		expect(view.values.agentModel).toBe("opus");

		const third = await store(env);
		expect(third.current().maxStepsPerRun).toBe(800);
		expect(third.current().agentModel).toBe("opus");
	});
});

describe("load", () => {
	test("ignores unknown keys and saved values that no longer parse, from the rows of an older version", async () => {
		await sandbox.db.insert(setting).values([
			{ key: "retiredSetting", value: "true" },
			{ key: "constructor", value: "{}" },
			{ key: "maxConcurrentRuns", value: "not json" },
			{ key: "maxStepsPerRun", value: "0" },
			{ key: "agentModel", value: JSON.stringify("opus") },
		]);
		const s = await store({ NIGHTSHIFT_MAX_STEPS_PER_RUN: "900" });
		expect(s.current().maxConcurrentRuns).toBe(2);
		expect(s.view().fields.maxConcurrentRuns.source).toBe("default");
		expect(s.current().maxStepsPerRun).toBe(900);
		expect(s.view().fields.maxStepsPerRun.source).toBe("env");
		expect(s.current().agentModel).toBe("opus");
		expect(s.view().fields.agentModel.source).toBe("saved");
		expect(Object.keys(s.current())).not.toContain("retiredSetting");
	});

	test("a store sees a value saved through another store on its document at once", async () => {
		const document = await sandbox.openDocument();
		const a = await store({}, document);
		const b = await store({}, document);
		await a.save({ maxConcurrentRuns: 5 });
		expect(b.current().maxConcurrentRuns).toBe(5);
	});

	test("ignores a value in the document that no longer parses", async () => {
		const document = await sandbox.openDocument();
		await document.change(() => {
			document.settings.set("maxConcurrentRuns", "five");
			document.settings.set("agentModel", "opus");
		});
		const s = await store({}, document);
		expect(s.view().fields.maxConcurrentRuns.source).toBe("default");
		expect(s.current().agentModel).toBe("opus");
	});
});

test("run() is the engine's part of the current values", async () => {
	const fresh = await store();
	expect(fresh.run()).toEqual(defaultRunSettings());
	// The wiring gives the default model of the knowledge.
	expect(fresh.current().embeddingModel).toBe("qwen3-embedding:0.6b");
	const s = await store({ NIGHTSHIFT_MAX_CONCURRENT_RUNS: "3" });
	await s.save({
		maxStepsPerRun: 50,
		networkGraceMinutes: 10,
		budgetUsd: 4.5,
		idleMinutes: 20,
		scheduler: false,
	});
	expect(s.run()).toEqual({
		scheduler: false,
		maxConcurrentRuns: 3,
		maxStepsPerRun: 50,
		budgetUsd: 4.5,
		maxTurns: null,
		resumeInterruptedRuns: true,
		cleanUpRuns: true,
		cleanUpAfterDays: 90,
		policy: {
			usageLimitFirstWaitMinutes: 5,
			usageLimitMaxWaitMinutes: 60,
			networkGraceMinutes: 10,
			idleMinutes: 20,
		},
	});
	// Null forgets the budget: back to none.
	await s.save({ budgetUsd: null });
	expect(s.run().budgetUsd).toBeNull();
});
