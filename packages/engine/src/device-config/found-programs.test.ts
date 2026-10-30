import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { type ConfigStores, openConfigStores } from "./config-stores";
import type { SecretBackend } from "./connections";
import { foundPrograms, setUpProgram } from "./found-programs";

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

async function makeStores(
	env: Record<string, string> = {},
): Promise<ConfigStores> {
	return openConfigStores({
		document: await sandbox.openDocument(),
		env,
		secrets: noSecrets,
	});
}

/** A computer with these programs, and no other. */
const computerWith =
	(...programs: string[]) =>
	(program: string) =>
		programs.includes(program) ? `/usr/local/bin/${program}` : null;

describe("the programs found on this computer", () => {
	test("offers the agent CLIs and the kits' tools it finds, agents first", async () => {
		const stores = await makeStores();
		const which = computerWith("claude", "pi", "gh", "aws");
		expect(foundPrograms(stores, which)).toEqual([
			{
				kind: "agent",
				program: "claude",
				harness: "claude-code",
				label: "Claude Code",
			},
			{ kind: "agent", program: "pi", harness: "pi", label: "pi" },
			{ kind: "tool", program: "gh", label: "GitHub CLI" },
		]);
		expect(foundPrograms(stores, computerWith())).toEqual([]);
	});

	test("looks for the program the harness's setting names", async () => {
		const stores = await makeStores({ NIGHTSHIFT_CLAUDE_BIN: "claude-beta" });
		expect(
			foundPrograms(stores, computerWith("claude", "claude-beta")).map(
				(found) => found.program,
			),
		).toEqual(["claude-beta"]);
	});

	test("an agent CLI with a profile, and a tool that runs the program, are set up", async () => {
		const stores = await makeStores();
		const which = computerWith("claude", "codex", "gh", "acli");
		await setUpProgram(stores, "claude", which);
		// A second account of gh counts: it runs gh.
		await stores.cliTools.save({ name: "gh-work", program: "gh" });
		expect(foundPrograms(stores, which).map((found) => found.program)).toEqual([
			"codex",
			"acli",
		]);
	});

	test("setting up an agent CLI adds its harness and a profile named after it", async () => {
		const stores = await makeStores();
		await stores.settings.save({ harnesses: ["claude-code"] });
		const which = computerWith("pi", "claude");
		expect(await setUpProgram(stores, "pi", which)).toMatchObject({
			kind: "agent",
			name: "pi",
		});
		expect(stores.settings.current().harnesses).toContain("pi");
		expect(stores.profiles.byName("pi")).toMatchObject({
			harness: "pi",
			permissionMode: "acceptEdits",
		});
	});

	test("a taken profile name gets a number", async () => {
		const stores = await makeStores();
		const which = computerWith("claude", "codex");
		await setUpProgram(stores, "codex", which);
		const codex = stores.profiles.byName("codex");
		if (!codex) throw new Error("Expected the codex profile.");
		// Rename it to the name the claude profile wants.
		await stores.profiles.save(
			{ ...codex, name: "claude" } as Parameters<
				typeof stores.profiles.save
			>[0],
			codex.id,
		);
		expect(await setUpProgram(stores, "claude", which)).toMatchObject({
			kind: "agent",
			name: "claude_2",
		});
	});

	test("setting up a CLI tool saves a tool of its name", async () => {
		const stores = await makeStores();
		expect(await setUpProgram(stores, "acli", computerWith("acli"))).toEqual({
			kind: "tool",
			name: "acli",
		});
		expect(stores.cliTools.get("acli")).not.toBeNull();
	});

	test("refuses a program that is not found, or is set up already", async () => {
		const stores = await makeStores();
		const which = computerWith("gh");
		await expect(setUpProgram(stores, "acli", which)).rejects.toThrow(
			"does not find acli",
		);
		await setUpProgram(stores, "gh", which);
		await expect(setUpProgram(stores, "gh", which)).rejects.toThrow(
			"set up already",
		);
	});
});
