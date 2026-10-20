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
	dir = await mkdtemp(join(tmpdir(), "nightshift-opencode-check-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

const fakeCli = (name: string, answers: Record<string, CliAnswer>) =>
	fakeCliIn(dir, name, answers);

describe("checkHarness: opencode", () => {
	test("OpenCode 2.x is flagged as unsupported, with the version normalised", async () => {
		const bin = await fakeCli("opencode", {
			"--version": { stdout: "opencode v2.0.22\n" },
		});
		const check = await checkHarness("opencode", bin);
		expect(check.version).toBe("2.0.22");
		expect(check.problem).toContain("OpenCode 2.0.22 is not supported");
	});

	test("OpenCode 1.x is fine", async () => {
		const bin = await fakeCli("opencode", {
			"--version": { stdout: "1.19.2\n" },
		});
		const check = await checkHarness("opencode", bin);
		expect(check.version).toBe("1.19.2");
		expect(check.problem).toBeNull();
	});

	test("a missing OpenCode is a problem", async () => {
		expect(
			(await checkHarness("opencode", "nightshift-no-such-opencode")).problem,
		).toBe(
			"OpenCode is not installed, or Night Shift cannot find it. Install it, or enter its path.",
		);
	});
});
