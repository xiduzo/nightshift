import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setting } from "@nightshift/db/schema";

import type { DeviceDocument } from "./device/document";
import { createSettingsStore, defaultRunSettings } from "./settings";
import { createSandbox, type Sandbox } from "./test-support";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

/** `${NAME}`: a reference to a secret. */
const ref = (name: string) => `\${${name}}`;

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

/** The keys with a saved value, as the next start reads them. */
async function savedKeys(): Promise<string[]> {
	return [...(await sandbox.openDocument()).settings.keys()].sort();
}

describe("precedence", () => {
	test("with nothing saved and no environment, every setting is its default", async () => {
		const s = await store();
		expect(s.current().maxConcurrentRuns).toBe(2);
		expect(s.current().scheduler).toBe(true);
		expect(s.current().claudeBin).toBe("claude");
		expect(s.view().fields.maxConcurrentRuns).toEqual({
			source: "default",
			default: 2,
			env: "NIGHTSHIFT_MAX_CONCURRENT_RUNS",
		});
		// A setting with no environment variable says so by leaving `env` out.
		expect(s.view().fields.networkGraceMinutes).toEqual({
			source: "default",
			default: 240,
		});
		expect(s.run()).toEqual(defaultRunSettings());
	});

	test("the environment beats the default, and a saved value beats both", async () => {
		const s = await store({
			NIGHTSHIFT_MAX_CONCURRENT_RUNS: " 4 ",
			NIGHTSHIFT_CLAUDE_BIN: "  /opt/claude  ",
		});
		expect(s.current().maxConcurrentRuns).toBe(4);
		expect(s.current().claudeBin).toBe("/opt/claude");
		expect(s.view().fields.maxConcurrentRuns).toEqual({
			source: "env",
			default: 2,
			env: "NIGHTSHIFT_MAX_CONCURRENT_RUNS",
			envValue: 4,
		});

		const view = await s.save({ maxConcurrentRuns: 6 });
		expect(view.values.maxConcurrentRuns).toBe(6);
		// The environment's value still shows, as what forgetting goes back to.
		expect(view.fields.maxConcurrentRuns).toEqual({
			source: "saved",
			default: 2,
			env: "NIGHTSHIFT_MAX_CONCURRENT_RUNS",
			envValue: 4,
		});
		expect(s.run().maxConcurrentRuns).toBe(6);
	});

	test.each([
		["NIGHTSHIFT_MAX_CONCURRENT_RUNS", "abc"],
		["NIGHTSHIFT_MAX_CONCURRENT_RUNS", "0"],
		["NIGHTSHIFT_MAX_CONCURRENT_RUNS", "2.5"],
		["NIGHTSHIFT_MAX_CONCURRENT_RUNS", "17"],
		["NIGHTSHIFT_MAX_CONCURRENT_RUNS", ""],
		["NIGHTSHIFT_MAX_STEPS_PER_RUN", "-1"],
	])("an invalid %s=%p is ignored", async (name, raw) => {
		const s = await store({ [name]: raw });
		expect(s.current().maxConcurrentRuns).toBe(2);
		expect(s.current().maxStepsPerRun).toBe(500);
		const fields = s.view().fields;
		expect(fields.maxConcurrentRuns.source).toBe("default");
		expect(fields.maxConcurrentRuns.envValue).toBeUndefined();
		expect(fields.maxStepsPerRun.source).toBe("default");
	});

	test("a blank binary path in the environment is ignored", async () => {
		const s = await store({ NIGHTSHIFT_CODEX_BIN: "   " });
		expect(s.current().codexBin).toBe("codex");
		expect(s.view().fields.codexBin.source).toBe("default");
	});
});

describe("the scheduler switch", () => {
	test("NIGHTSHIFT_SCHEDULER=off locks the scheduler off, even over a saved true", async () => {
		const s = await store({ NIGHTSHIFT_SCHEDULER: " OFF " });
		await s.save({ scheduler: true });
		expect(s.current().scheduler).toBe(false);
		expect(s.run().scheduler).toBe(false);
		const field = s.view().fields.scheduler;
		expect(field.source).toBe("env");
		expect(field.envValue).toBe(false);
		expect(field.locked).toContain("started with schedules turned off");
	});

	test("any other NIGHTSHIFT_SCHEDULER value leaves it on, and a saved false wins", async () => {
		const s = await store({ NIGHTSHIFT_SCHEDULER: "on" });
		expect(s.current().scheduler).toBe(true);
		expect(s.view().fields.scheduler).toMatchObject({
			source: "env",
			envValue: true,
		});
		expect(s.view().fields.scheduler.locked).toBeUndefined();
		await s.save({ scheduler: false });
		expect(s.current().scheduler).toBe(false);
		expect(s.view().fields.scheduler.source).toBe("saved");
	});
});

describe("automatic resume", () => {
	test("on by default; NIGHTSHIFT_RESUME_INTERRUPTED_RUNS turns it off, and a saved value wins", async () => {
		expect((await store()).run().resumeInterruptedRuns).toBe(true);
		const s = await store({ NIGHTSHIFT_RESUME_INTERRUPTED_RUNS: " Off " });
		expect(s.run().resumeInterruptedRuns).toBe(false);
		expect(s.view().fields.resumeInterruptedRuns).toEqual({
			source: "env",
			default: true,
			env: "NIGHTSHIFT_RESUME_INTERRUPTED_RUNS",
			envValue: false,
		});
		await s.save({ resumeInterruptedRuns: true });
		expect(s.run().resumeInterruptedRuns).toBe(true);
	});

	test("a NIGHTSHIFT_RESUME_INTERRUPTED_RUNS that is not on or off is ignored", async () => {
		const s = await store({ NIGHTSHIFT_RESUME_INTERRUPTED_RUNS: "maybe" });
		expect(s.run().resumeInterruptedRuns).toBe(true);
		expect(s.view().fields.resumeInterruptedRuns.source).toBe("default");
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

	test("custom agents are saved with their command, arguments and env", async () => {
		const s = await store();
		expect(s.current().customAgents).toEqual([]);
		await s.save({
			customAgents: [
				{
					slug: "goose",
					label: "Goose",
					command: "goose",
					args: ["acp"],
					env: { GOOSE_API_KEY: ref("GOOSE_API_KEY") },
				},
			],
		});
		expect((await store()).current().customAgents).toEqual([
			{
				slug: "goose",
				label: "Goose",
				command: "goose",
				args: ["acp"],
				env: { GOOSE_API_KEY: ref("GOOSE_API_KEY") },
			},
		]);
	});

	test("saving again replaces the value", async () => {
		const s = await store();
		await s.save({ networkGraceMinutes: 30 });
		await s.save({ networkGraceMinutes: 45 });
		expect((await store()).current().networkGraceMinutes).toBe(45);
		expect(await savedKeys()).toEqual(["networkGraceMinutes"]);
	});

	test.each([
		["an unknown key", { nope: 1 }],
		["a run cap of 0", { maxConcurrentRuns: 0 }],
		["a run cap over 16", { maxConcurrentRuns: 17 }],
		["a fractional run cap", { maxConcurrentRuns: 1.5 }],
		["a negative wait", { networkGraceMinutes: -1 }],
		["a wait over a week", { networkGraceMinutes: 10_081 }],
		["a blank binary", { codexBin: "  " }],
		["an unknown harness", { agentHarness: "aider" }],
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
		const s = await store();
		// biome-ignore lint/suspicious/noExplicitAny: the patch is invalid on purpose.
		await expect(s.save(patch as any)).rejects.toThrow();
		expect(await savedKeys()).toEqual([]);
		expect(s.view().fields.maxConcurrentRuns.source).toBe("default");
	});

	test("refuses a first usage-limit wait longer than the longest one", async () => {
		const s = await store();
		await expect(s.save({ usageLimitFirstWaitMinutes: 90 })).rejects.toThrow(
			"The first usage-limit wait cannot be longer than the longest one.",
		);
		await expect(s.save({ usageLimitMaxWaitMinutes: 3 })).rejects.toThrow(
			"cannot be longer",
		);
		// Both at once is fine when they fit together.
		await s.save({
			usageLimitFirstWaitMinutes: 90,
			usageLimitMaxWaitMinutes: 120,
		});
		expect(s.run().policy).toEqual({
			usageLimitFirstWaitMinutes: 90,
			usageLimitMaxWaitMinutes: 120,
			networkGraceMinutes: 240,
		});
		expect(await savedKeys()).toEqual([
			"usageLimitFirstWaitMinutes",
			"usageLimitMaxWaitMinutes",
		]);
	});

	test("forgetting the longest wait checks the first wait against the default it falls back to", async () => {
		const s = await store();
		await s.save({
			usageLimitFirstWaitMinutes: 80,
			usageLimitMaxWaitMinutes: 100,
		});
		// Forgetting the longest wait brings back its default of 60, under the first wait of 80.
		await expect(s.save({ usageLimitMaxWaitMinutes: null })).rejects.toThrow(
			"cannot be longer",
		);
		expect(s.current().usageLimitMaxWaitMinutes).toBe(100);
		// Forgetting the first wait too brings both back to their defaults.
		await s.save({
			usageLimitFirstWaitMinutes: null,
			usageLimitMaxWaitMinutes: null,
		});
		expect(s.current().usageLimitFirstWaitMinutes).toBe(5);
		expect(s.current().usageLimitMaxWaitMinutes).toBe(60);
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
	const s = await store({ NIGHTSHIFT_MAX_CONCURRENT_RUNS: "3" });
	await s.save({
		maxStepsPerRun: 50,
		networkGraceMinutes: 10,
		scheduler: false,
	});
	expect(s.run()).toEqual({
		scheduler: false,
		maxConcurrentRuns: 3,
		maxStepsPerRun: 50,
		resumeInterruptedRuns: true,
		policy: {
			usageLimitFirstWaitMinutes: 5,
			usageLimitMaxWaitMinutes: 60,
			networkGraceMinutes: 10,
		},
	});
});
