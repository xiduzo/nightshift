import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AgentProfile } from "@nightshift/flows";
import { NIGHT_SHIFT } from "../contract";
import { openConfigStores } from "../testing/config-stores";
import { createSandbox, type Sandbox } from "../testing/test-support";
import type { SecretBackend } from "./connections";
import { saveProfile } from "./edits";
import type { DeviceConfig } from "./wire";

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

async function makeStores(): Promise<DeviceConfig> {
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

	test("a model profile keeps its address, and a vendor API refuses one", async () => {
		const stores = await makeStores();
		const address = { baseUrl: "http://gpu-box:11434", apiKey: "PROXY_KEY" };
		const saved = await saveProfile(
			stores,
			{ name: "remote", decider: "ollama", address },
			unused,
		);
		expect(stores.profiles.get(saved.id)).toMatchObject({ address });
		expect(
			await errorOf(
				saveProfile(
					stores,
					{ name: "jev", decider: "typesafe", address },
					unused,
				),
			),
		).toBe(
			'The decider "typesafe" always uses its own service, so it takes no address. Remove the address, or choose another decider.',
		);
	});
});

describe("connections and CLI tools", () => {
	test("a rename moves the profiles that name it, a removal takes it off", async () => {
		const stores = await makeStores();
		await stores.deviceConfig.saveConnection(NIGHT_SHIFT, {
			connection: { name: "gh", server },
		});
		await stores.cliTools.save({ name: "jq" });
		const fast = await saveProfile(
			stores,
			profile({ connections: ["gh"], clis: ["jq"] }),
			unused,
		);

		expect(
			await errorOf(
				stores.deviceConfig.saveConnection(NIGHT_SHIFT, {
					connection: { name: "gh", server },
					previousName: "other",
				}),
			),
		).toBe('A connection named "gh" already exists. Pick another name.');

		await stores.deviceConfig.saveConnection(NIGHT_SHIFT, {
			connection: { name: "github", server },
			previousName: "gh",
		});
		expect(stores.connections.list().map((c) => c.name)).toEqual(["github"]);
		expect(stores.profiles.get(fast.id)).toMatchObject({
			connections: ["github"],
		});

		await stores.deviceConfig.removeConnection(NIGHT_SHIFT, { name: "github" });
		await stores.deviceConfig.removeCliTool(NIGHT_SHIFT, { name: "jq" });
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
		await stores.deviceConfig.addHarness(NIGHT_SHIFT, { harness: "gemini" });
		await stores.deviceConfig.addHarness(NIGHT_SHIFT, { harness: "gemini" });
		expect(stores.settings.current().harnesses).toEqual([...before, "gemini"]);

		const fast = await saveProfile(
			stores,
			profile({ harness: "gemini" }),
			unused,
		);
		expect(
			await errorOf(
				stores.deviceConfig.removeHarness(NIGHT_SHIFT, { harness: "gemini" }),
			),
		).toBe(
			"The profile fast run on Gemini CLI. Move it to another harness first.",
		);
		await stores.profiles.remove(fast.id);
		await stores.deviceConfig.removeHarness(NIGHT_SHIFT, { harness: "gemini" });
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
		await stores.deviceConfig.saveCustomAgent(NIGHT_SHIFT, { agent: goose });
		expect(
			await errorOf(
				stores.deviceConfig.saveCustomAgent(NIGHT_SHIFT, { agent: goose }),
			),
		).toBe("A custom agent named acp:goose already exists. Pick another name.");
		expect(
			await errorOf(
				stores.deviceConfig.saveCustomAgent(NIGHT_SHIFT, {
					agent: goose,
					previousSlug: "gone",
				}),
			),
		).toBe("This custom agent was removed. Add it again.");
		const saved = await stores.deviceConfig.saveCustomAgent(NIGHT_SHIFT, {
			agent: { ...goose, slug: "other", label: "Goose 2" },
			previousSlug: "goose",
		});
		expect(saved).toEqual({ ...goose, label: "Goose 2" });
		await stores.deviceConfig.removeHarness(NIGHT_SHIFT, {
			harness: "acp:goose",
		});
		expect(stores.settings.current().customAgents).toEqual([]);
	});
});
