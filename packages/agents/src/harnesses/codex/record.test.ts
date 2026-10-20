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
	dir = await mkdtemp(join(tmpdir(), "nightshift-codex-check-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

const fakeCli = (name: string, answers: Record<string, CliAnswer>) =>
	fakeCliIn(dir, name, answers);

describe("checkHarness: codex", () => {
	test("a logged-in Codex: the login line is the account", async () => {
		const bin = await fakeCli("codex", {
			"--version": { stdout: "codex-cli 0.50.0\n" },
			"login status": { stderr: "Logged in using ChatGPT\n" },
		});
		const check = await checkHarness("codex", bin);
		expect(check).toMatchObject({
			version: "codex-cli 0.50.0",
			account: "Logged in using ChatGPT",
			problem: null,
		});
	});

	test("a failing `login status` is the problem", async () => {
		const bin = await fakeCli("codex", {
			"--version": { stdout: "codex-cli 0.50.0" },
			"login status": { stderr: "Not logged in\n", code: 1 },
		});
		const check = await checkHarness("codex", bin);
		expect(check.account).toBeNull();
		expect(check.problem).toBe("Not logged in");
	});

	test("a silent failing `login status` says how to log in", async () => {
		const bin = await fakeCli("codex", {
			"--version": { stdout: "codex-cli 0.50.0" },
			"login status": { code: 1 },
		});
		expect((await checkHarness("codex", bin)).problem).toBe(
			"Not logged in. Run `codex login`.",
		);
	});
});
