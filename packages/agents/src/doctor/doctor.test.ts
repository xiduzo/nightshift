import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CliAnswer, fakeCli as fakeCliIn } from "../testing/fixtures/cli";
import { checkCustomAgent, resolveBin } from ".";

/** Every CLI here is a tiny fake script: the checks never run a real one. */

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "nightshift-doctor-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

const fakeCli = (name: string, answers: Record<string, CliAnswer>) =>
	fakeCliIn(dir, name, answers);

describe("resolveBin", () => {
	test("a path that is a file resolves to itself", async () => {
		const path = await fakeCli("tool", {});
		expect(await resolveBin(path)).toBe(path);
	});

	test("a missing path or a directory does not resolve", async () => {
		expect(await resolveBin(join(dir, "missing"))).toBeNull();
		await mkdir(join(dir, "folder"));
		expect(await resolveBin(join(dir, "folder"))).toBeNull();
		expect(await resolveBin("~/nightshift-surely-not-here/claude")).toBeNull();
	});

	test("a bare name is looked up on the PATH", async () => {
		expect(await resolveBin("sh")).toBe(Bun.which("sh") as string);
		expect(await resolveBin("sh")).toMatch(/\/sh$/);
		expect(await resolveBin("nightshift-doctor-not-anywhere")).toBeNull();
	});
});

describe("checkCustomAgent", () => {
	test("a command that is there is ready, with or without a version", async () => {
		const bin = await fakeCli("goose", {});
		expect(await checkCustomAgent(bin, "Goose")).toMatchObject({
			path: bin,
			version: null,
			problem: null,
		});
	});

	test("a command that is not there says how to fix it", async () => {
		expect(
			(await checkCustomAgent("no-such-agent-here", "Goose")).problem,
		).toBe(
			"Night Shift cannot find no-such-agent-here on this computer. Install Goose, or enter the full path of its command.",
		);
	});
});
