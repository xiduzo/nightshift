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
});
