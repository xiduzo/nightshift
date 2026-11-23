import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { putAgentBinsOnPath } from "./bin-path";

let home: string;
beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "nightshift-bin-path-"));
});
afterEach(async () => {
	await rm(home, { recursive: true, force: true });
});

describe("the agent bin folder on the PATH", () => {
	test("goes first when it exists and the PATH lacks it", async () => {
		await mkdir(join(home, ".local/bin"), { recursive: true });
		const env: Record<string, string | undefined> = {
			PATH: "/usr/bin:/bin",
			HOME: home,
		};
		expect(putAgentBinsOnPath(env)).toBe(true);
		expect(env.PATH).toBe(`${join(home, ".local/bin")}:/usr/bin:/bin`);
		// Once is enough.
		expect(putAgentBinsOnPath(env)).toBe(false);
		expect(env.PATH).toBe(`${join(home, ".local/bin")}:/usr/bin:/bin`);
	});

	test("keeps the order of a PATH that has it already", async () => {
		await mkdir(join(home, ".local/bin"), { recursive: true });
		const path = `/opt/homebrew/bin:${join(home, ".local/bin")}:/usr/bin`;
		const env: Record<string, string | undefined> = { PATH: path };
		expect(putAgentBinsOnPath(env, home)).toBe(false);
		expect(env.PATH).toBe(path);
	});

	test("leaves the PATH alone when the folder does not exist", () => {
		const env: Record<string, string | undefined> = { PATH: "/usr/bin" };
		expect(putAgentBinsOnPath(env, home)).toBe(false);
		expect(env.PATH).toBe("/usr/bin");
	});
});
