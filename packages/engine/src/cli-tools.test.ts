import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { agentProfile } from "@nightshift/db/schema/nightshift";

import { cliToolsInstruction, createCliToolStore } from "./cli-tools";
import { createProfileStore } from "./profiles";
import { createSandbox, type Sandbox } from "./test-support";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

describe("createCliToolStore", () => {
	test("a new daemon has no CLI tools", async () => {
		const store = createCliToolStore({ db: sandbox.db });
		await store.load();
		expect(store.list()).toEqual([]);
	});

	test("saves, lists sorted, changes a description, and removes", async () => {
		const store = createCliToolStore({ db: sandbox.db });
		await store.load();
		await store.save({ name: "gh", description: "GitHub" });
		await store.save({ name: "aws" });
		await store.save({ name: "gh", description: "  " });

		const again = createCliToolStore({ db: sandbox.db });
		await again.load();
		expect(again.list().map((t) => [t.name, t.description])).toEqual([
			["aws", null],
			["gh", null],
		]);
		expect(again.names()).toEqual(new Set(["aws", "gh"]));

		await again.remove("aws");
		expect(again.get("aws")).toBeNull();
		await store.load();
		expect([...store.names()]).toEqual(["gh"]);
	});

	test("a name that is not a program name is refused", async () => {
		const store = createCliToolStore({ db: sandbox.db });
		await expect(store.save({ name: "gh pr" })).rejects.toThrow();
		await expect(store.save({ name: "../gh" })).rejects.toThrow();
	});
});

describe("profiles saved with the GitHub tool set", () => {
	test("read as profiles with the CLI tool gh", async () => {
		await sandbox.db.insert(agentProfile).values({
			name: "builder",
			settings: JSON.stringify({
				harness: "claude-code",
				model: "sonnet",
				permissionMode: "auto",
				tools: ["github"],
				connections: [],
			}),
		});
		const profiles = createProfileStore({ db: sandbox.db });
		await profiles.load();
		expect(profiles.settingsFor("builder")).toMatchObject({ clis: ["gh"] });
	});
});

describe("cliToolsInstruction", () => {
	test("no CLI tools: nothing", () => {
		expect(cliToolsInstruction([])).toBe("");
	});

	test("each tool with its description and help; a tool without either is its name", () => {
		const text = cliToolsInstruction([
			{ name: "gh", description: "GitHub", help: "Usage: gh <command>" },
			{ name: "jq", description: null, help: null },
		]);
		expect(text).toStartWith("## CLI tools\n\nYou can run these programs");
		expect(text).toContain(
			"### gh\n\nGitHub\n\n`gh --help`:\n\n```text\nUsage: gh <command>\n```\n\n### jq",
		);
		expect(text).toEndWith("### jq");
	});

	test("help with a code fence of its own gets a longer fence", () => {
		const text = cliToolsInstruction([
			{ name: "x", description: null, help: "Example:\n```\nx run\n```" },
		]);
		expect(text).toContain("````text\nExample:\n```\nx run\n```\n````");
	});
});
