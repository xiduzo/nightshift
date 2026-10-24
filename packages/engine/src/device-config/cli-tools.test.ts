import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { agentProfile } from "@nightshift/db/schema";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { cliToolsInstruction, createCliToolStore } from "./cli-tools";
import { createProfileStore } from "./profiles";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

describe("createCliToolStore", () => {
	test("a new daemon has no CLI tools", async () => {
		const store = createCliToolStore({
			document: await sandbox.openDocument(),
		});
		await store.load();
		expect(store.list()).toEqual([]);
	});

	test("saves, lists sorted, changes a description, and removes", async () => {
		const document = await sandbox.openDocument();
		const store = createCliToolStore({ document });
		await store.load();
		await store.save({ name: "gh", description: "GitHub" });
		await store.save({ name: "aws" });
		await store.save({ name: "gh", description: "  " });

		// After a restart.
		const again = createCliToolStore({
			document: await sandbox.openDocument(),
		});
		await again.load();
		expect(again.list().map((t) => [t.name, t.description])).toEqual([
			["aws", null],
			["gh", null],
		]);
		expect(again.names()).toEqual(new Set(["aws", "gh"]));

		await again.remove("aws");
		expect(again.get("aws")).toBeNull();
		const third = createCliToolStore({
			document: await sandbox.openDocument(),
		});
		expect([...third.names()]).toEqual(["gh"]);
	});

	test("keeps a tool's program, login and git host", async () => {
		const store = createCliToolStore({
			document: await sandbox.openDocument(),
		});
		await store.save({
			name: "gh-work",
			program: "gh",
			login: { env: { GH_TOKEN: "${GH_WORK_TOKEN}" } },
			git: { host: "GitHub.com" },
		});
		await store.save({
			name: "acli-dimpact",
			program: "acli",
			login: {
				folder: "HOME",
				signIn: {
					command: "acli jira auth login --token",
					input: "${DIMPACT_TOKEN}",
				},
			},
		});
		const again = createCliToolStore({
			document: await sandbox.openDocument(),
		});
		expect(again.get("gh-work")).toMatchObject({
			program: "gh",
			login: { env: { GH_TOKEN: "${GH_WORK_TOKEN}" } },
			git: { host: "github.com", helper: "auth git-credential" },
		});
		expect(again.get("acli-dimpact")?.login).toEqual({
			env: {},
			folder: "HOME",
			signIn: {
				command: "acli jira auth login --token",
				input: "${DIMPACT_TOKEN}",
			},
		});
	});

	test("a program of the same name and an empty login are none", async () => {
		const store = createCliToolStore({
			document: await sandbox.openDocument(),
		});
		const saved = await store.save({
			name: "gh",
			program: "gh",
			login: { env: {} },
		});
		expect(saved).toMatchObject({ program: null, login: null, git: null });
	});

	test("a sign-in needs a folder of its own", async () => {
		const store = createCliToolStore({
			document: await sandbox.openDocument(),
		});
		await expect(
			store.save({
				name: "acli",
				login: { signIn: { command: "acli jira auth login" } },
			}),
		).rejects.toThrow(/folder of its own/);
	});

	test("an older entry, or a login this version cannot read, runs without one", async () => {
		const document = await sandbox.openDocument();
		await document.change(() => {
			document.cliTools.set("aws", { description: null, updatedAt: 1 });
			document.cliTools.set("gh", {
				description: "GitHub",
				login: { env: { "not a name": "x" } },
				updatedAt: 2,
			});
		});
		const store = createCliToolStore({ document });
		expect(store.get("aws")).toMatchObject({
			program: null,
			login: null,
			git: null,
		});
		expect(store.get("gh")).toMatchObject({
			description: "GitHub",
			login: null,
		});
	});

	test("a name that is not a program name is refused", async () => {
		const store = createCliToolStore({
			document: await sandbox.openDocument(),
		});
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
		const profiles = createProfileStore({
			document: await sandbox.openDocument(),
		});
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

	test("a tool that runs another program says so, and whether it has its own login", () => {
		const text = cliToolsInstruction([
			{
				name: "gh-work",
				program: "gh",
				login: true,
				description: "GitHub as work-org.",
				help: null,
			},
			{ name: "g", program: "git", description: null, help: null },
		]);
		expect(text).toContain(
			"### gh-work\n\nGitHub as work-org.\n\n`gh-work` runs `gh` with its own login. Type `gh-work` where you would type `gh`.",
		);
		expect(text).toContain(
			"### g\n\n`g` runs `git`. Type `g` where you would type `git`.",
		);
	});

	test("help with a code fence of its own gets a longer fence", () => {
		const text = cliToolsInstruction([
			{ name: "x", description: null, help: "Example:\n```\nx run\n```" },
		]);
		expect(text).toContain("````text\nExample:\n```\nx run\n```\n````");
	});
});
