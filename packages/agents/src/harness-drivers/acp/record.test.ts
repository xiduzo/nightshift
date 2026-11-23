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
	dir = await mkdtemp(join(tmpdir(), "nightshift-pi-check-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

const fakeCli = (name: string, answers: Record<string, CliAnswer>) =>
	fakeCliIn(dir, name, answers);

describe("checkHarness: pi", () => {
	test("pi 0.81 or later is ready", async () => {
		const bin = await fakeCli("pi", { "--version": { stdout: "1.3.0\n" } });
		expect(await checkHarness("pi", bin)).toMatchObject({
			version: "1.3.0",
			problem: null,
		});
	});

	test("an older pi is a problem: pi-acp would wait for it forever", async () => {
		// pi 0.73 prints its version to stderr.
		const bin = await fakeCli("pi", { "--version": { stderr: "0.73.0\n" } });
		expect((await checkHarness("pi", bin)).problem).toBe(
			"pi 0.73.0 is too old. Night Shift needs pi 0.81 or later. Update pi, or enter the path of a newer one.",
		);
	});
});
