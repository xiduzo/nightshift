import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AgentProfile } from "@nightshift/flows";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { type ConfigStores, openConfigStores } from "./config-stores";
import type { SecretBackend } from "./connections";
import {
	addHarness,
	removeCliTool,
	removeConnection,
	removeHarness,
	saveConnection,
	saveCustomAgent,
	saveProfile,
} from "./edits";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const noSecrets: SecretBackend = {
	get: async () => null,
	set: async () => {},
	delete: async () => {},
};

async function makeStores(): Promise<ConfigStores> {
	return openConfigStores({
		document: await sandbox.openDocument(),
		env: {},
		secrets: noSecrets,
	});
}

const server = { command: "gh-mcp", args: [], env: {} };

function profile(over: Partial<AgentProfile> = {}): AgentProfile {
	return {
		name: "fast",
		harness: "claude-code",
		model: "sonnet",
		permissionMode: "acceptEdits",
		clis: [],
		connections: [],
		...over,
	} as AgentProfile;
}

const unused = {};

async function errorOf(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (error) {
		return (error as Error).message;
	}
	throw new Error("It did not throw.");
}

describe("saveProfile", () => {
	test("refuses a connection or a CLI tool that does not exist", async () => {
		const stores = await makeStores();
		expect(
			await errorOf(
				saveProfile(stores, profile({ connections: ["gh"] }), unused),
			),
		).toBe(
			'There is no connection named "gh". Add it under Agents → Tools first.',
		);
		expect(
			await errorOf(saveProfile(stores, profile({ clis: ["jq"] }), unused)),
		).toBe(
			'There is no CLI tool named "jq". Add it under Agents → Tools first.',
		);
		expect(stores.profiles.list()).toEqual([]);
	});

	test("refuses a taken name and a removed profile", async () => {
		const stores = await makeStores();
		const fast = await saveProfile(stores, profile(), unused);
		await saveProfile(stores, profile({ name: "slow" }), unused);
		expect(await errorOf(saveProfile(stores, profile(), unused))).toBe(
			'A profile named "fast" already exists. Pick another name.',
		);
		expect(
			await errorOf(
				saveProfile(stores, profile({ name: "slow" }), {
					...unused,
					id: fast.id,
				}),
			),
		).toBe('A profile named "slow" already exists. Pick another name.');
		expect(
			await errorOf(
				saveProfile(stores, profile(), { ...unused, id: "p-gone" }),
			),
		).toBe("This profile was removed. Add it again.");
	});

	test("a new profile gets an id that no name can be", async () => {
		const stores = await makeStores();
		const saved = await saveProfile(stores, profile(), unused);
		expect(saved.id).toStartWith("p-");
		expect(stores.profiles.get(saved.id)?.name).toBe("fast");
	});

	test("a rename changes the name and keeps the id, so the flows that use it go on: they name the id", async () => {
		const stores = await makeStores();
		const fast = await saveProfile(stores, profile(), unused);
		const quick = await saveProfile(stores, profile({ name: "quick" }), {
			...unused,
			id: fast.id,
		});
		expect(quick.id).toBe(fast.id);
		expect(stores.profiles.list().map((p) => [p.id, p.name])).toEqual([
			[fast.id, "quick"],
		]);
		expect(stores.profiles.byName("quick")?.id).toBe(fast.id);
		expect(stores.profiles.byName("fast")).toBeNull();
	});

	test("an edit that keeps the name keeps the id", async () => {
		const stores = await makeStores();
		const fast = await saveProfile(stores, profile(), unused);
		await saveProfile(stores, profile({ model: "opus" }), {
			...unused,
			id: fast.id,
		});
		expect(stores.profiles.list()).toMatchObject([
			{ id: fast.id, name: "fast", model: "opus" },
		]);
	});
});

describe("connections and CLI tools", () => {
	test("a rename moves the profiles that name it, a removal takes it off", async () => {
		const stores = await makeStores();
		await saveConnection(stores, { name: "gh", server });
		await stores.cliTools.save({ name: "jq" });
		const fast = await saveProfile(
			stores,
			profile({ connections: ["gh"], clis: ["jq"] }),
			unused,
		);

		expect(
			await errorOf(saveConnection(stores, { name: "gh", server }, "other")),
		).toBe('A connection named "gh" already exists. Pick another name.');

		await saveConnection(stores, { name: "github", server }, "gh");
		expect(stores.connections.list().map((c) => c.name)).toEqual(["github"]);
		expect(stores.profiles.get(fast.id)).toMatchObject({
			connections: ["github"],
		});

		await removeConnection(stores, "github");
		await removeCliTool(stores, "jq");
		expect(stores.connections.list()).toEqual([]);
		expect(stores.cliTools.list()).toEqual([]);
		expect(stores.profiles.get(fast.id)).toMatchObject({
			connections: [],
			clis: [],
		});
	});
});

describe("harnesses", () => {
	test("adds once, and refuses to remove one a profile runs on", async () => {
		const stores = await makeStores();
		const before = stores.settings.current().harnesses;
		await addHarness(stores, "gemini");
		await addHarness(stores, "gemini");
		expect(stores.settings.current().harnesses).toEqual([...before, "gemini"]);

		const fast = await saveProfile(
			stores,
			profile({ harness: "gemini" }),
			unused,
		);
		expect(await errorOf(removeHarness(stores, "gemini"))).toBe(
			"The profile fast run on Gemini CLI. Move it to another harness first.",
		);
		await stores.profiles.remove(fast.id);
		await removeHarness(stores, "gemini");
		expect(stores.settings.current().harnesses).toEqual(before);
	});

	test("a custom agent keeps its slug, and goes with remove", async () => {
		const stores = await makeStores();
		const goose = {
			slug: "goose",
			label: "Goose",
			command: "goose",
			args: ["acp"],
			env: {},
		};
		await saveCustomAgent(stores, goose);
		expect(await errorOf(saveCustomAgent(stores, goose))).toBe(
			"A custom agent named acp:goose already exists. Pick another name.",
		);
		expect(await errorOf(saveCustomAgent(stores, goose, "gone"))).toBe(
			"This custom agent was removed. Add it again.",
		);
		const saved = await saveCustomAgent(
			stores,
			{ ...goose, slug: "other", label: "Goose 2" },
			"goose",
		);
		expect(saved).toEqual({ ...goose, label: "Goose 2" });
		await removeHarness(stores, "acp:goose");
		expect(stores.settings.current().customAgents).toEqual([]);
	});
});
