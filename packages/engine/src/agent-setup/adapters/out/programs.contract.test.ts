import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inMemoryPrograms } from "./in-memory-programs";
import { nodePrograms } from "./node-programs";
import { programsContract } from "./programs.contract";

const memory = programsContract("in-memory", () => ({
	programs: inMemoryPrograms({ programs: { curl: "/usr/bin/curl" } }),
	present: "curl",
	presentPath: "/usr/bin/curl",
	missing: "no-such-program",
}));

let home = "";
afterEach(async () => {
	if (home) await rm(home, { recursive: true, force: true });
	home = "";
});

const node = programsContract("node", () => {
	const env: Record<string, string | undefined> = {
		PATH: "/usr/bin:/bin",
		HOME: "/tmp",
	};
	return {
		programs: nodePrograms({
			home: "/tmp",
			env,
			which: (p) => (p === "curl" ? "/usr/bin/curl" : null),
		}),
		present: "curl",
		presentPath: "/usr/bin/curl",
		missing: "no-such-program",
	};
});

for (const suite of [memory, node]) {
	describe(`Programs (${suite.name})`, () => {
		for (const c of suite.cases) {
			test(c.name, c.run);
		}
	});
}

describe("nodePrograms found", () => {
	test("a path that exists, and a missing path", async () => {
		home = await mkdtemp(join(tmpdir(), "nightshift-programs-"));
		const path = join(home, "bin", "claude");
		await mkdir(join(home, "bin"), { recursive: true });
		const { writeFile } = await import("node:fs/promises");
		await writeFile(path, "");
		const programs = nodePrograms({
			home,
			env: { HOME: home },
			which: () => null,
		});
		expect(programs.found(path)).toBe(path);
		expect(programs.found(join(home, "missing"))).toBeNull();
		expect(programs.found("~/bin/claude")).toBe(path);
	});
});
