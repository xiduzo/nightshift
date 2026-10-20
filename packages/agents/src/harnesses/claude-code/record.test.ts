import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CliAnswer,
	fakeCli as fakeCliIn,
} from "../../testing/fixtures/cli";
import { checkHarness } from "../registry";

/** Every CLI here is a tiny fake script: the checks never run a real one. */

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "nightshift-claude-check-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

const fakeCli = (name: string, answers: Record<string, CliAnswer>) =>
	fakeCliIn(dir, name, answers);

describe("checkHarness: claude-code", () => {
	test("a logged-in Claude Code: version, account and plan", async () => {
		const bin = await fakeCli("claude", {
			"--version": { stdout: "2.1.3 (Claude Code)\n" },
			"auth status --json": {
				stdout: JSON.stringify({
					loggedIn: true,
					email: "night@example.com",
					orgName: "Night Shift",
					subscriptionType: "max",
					authMethod: "claude.ai",
				}),
			},
		});
		const check = await checkHarness("claude-code", bin);
		expect(check).toEqual({
			bin,
			path: bin,
			version: "2.1.3 (Claude Code)",
			account: "night@example.com",
			facts: [
				{ label: "Plan", value: "max" },
				{ label: "Organization", value: "Night Shift" },
				{ label: "Login", value: "claude.ai" },
			],
			problem: null,
			checkedAt: expect.any(Number),
		});
		expect(check).not.toHaveProperty("resolved");
	});

	test("not logged in is a problem", async () => {
		const bin = await fakeCli("claude", {
			"--version": { stdout: "2.1.3 (Claude Code)" },
			"auth status --json": {
				stdout: JSON.stringify({ loggedIn: false }),
				code: 1,
			},
		});
		const check = await checkHarness("claude-code", bin);
		expect(check.version).toBe("2.1.3 (Claude Code)");
		expect(check.account).toBeNull();
		expect(check.problem).toBe("Not logged in. Run `claude` once to log in.");
	});

	test("an older Claude Code without `auth status --json`: the version is enough", async () => {
		const bin = await fakeCli("claude", {
			"--version": { stdout: "1.0.0 (Claude Code)" },
		});
		const check = await checkHarness("claude-code", bin);
		expect(check).toMatchObject({
			version: "1.0.0 (Claude Code)",
			account: null,
			facts: [],
			problem: null,
		});
	});

	test("a failing --version is the problem, with its first stderr line", async () => {
		const bin = await fakeCli("claude", {
			"--version": { stderr: "\n  dyld: library not loaded\nmore\n", code: 1 },
		});
		const check = await checkHarness("claude-code", bin);
		expect(check.version).toBeNull();
		expect(check.problem).toBe("dyld: library not loaded");
	});

	test("a silent failing --version names its exit code", async () => {
		const bin = await fakeCli("claude", { "--version": { code: 4 } });
		expect((await checkHarness("claude-code", bin)).problem).toBe(
			"Claude Code failed when Night Shift checked its version.",
		);
	});

	test("a missing binary is a problem", async () => {
		const byPath = join(dir, "nope", "claude");
		expect(await checkHarness("claude-code", byPath)).toMatchObject({
			bin: byPath,
			path: null,
			version: null,
			problem: `Nothing is installed at ${byPath}. Check the path.`,
		});
		expect(
			(await checkHarness("claude-code", "nightshift-no-such-claude")).problem,
		).toBe(
			"Claude Code is not installed, or Night Shift cannot find it. Install it, or enter its path.",
		);
	});
});
