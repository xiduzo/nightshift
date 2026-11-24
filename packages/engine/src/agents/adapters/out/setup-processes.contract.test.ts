import { afterAll, beforeAll, describe, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bunSetupProcesses } from "./bun-setup-processes";
import { inMemorySetupProcesses } from "./in-memory-setup-processes";
import { setupProcessesContract } from "./setup-processes.contract";

/**
 * The real side starts a tiny program of a temp folder, never an installer
 * or a sign-in: it prints the file `go.say`, waits for the file
 * `go`, and exits with its content.
 */
let dir: string;
let program: string;
beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "nightshift-setup-contract-"));
	program = join(dir, "fake-cli");
	await writeFile(
		program,
		[
			"#!/bin/sh",
			'say() { if [ -f "$GO.say" ]; then cat "$GO.say"; rm "$GO.say"; fi; }',
			'while [ ! -s "$GO" ]; do say; sleep 0.02; done',
			"say",
			'exit "$(cat "$GO")"',
			"",
		].join("\n"),
	);
	await chmod(program, 0o755);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const suites = [
	setupProcessesContract("in-memory", () => {
		const processes = inMemorySetupProcesses();
		const exit = (code: number) => processes.started.at(-1)?.exit(code);
		return {
			processes,
			program: "claude",
			command: "curl -fsSL https://claude.ai/install.sh | bash",
			home: "/home/ada",
			env: { PATH: "/usr/bin" },
			print: (text) => processes.started.at(-1)?.print(text),
			finish: (code) => exit(code),
		};
	}),
	setupProcessesContract("bun", () => {
		const go = join(dir, crypto.randomUUID());
		return {
			processes: bunSetupProcesses(),
			program,
			command: program,
			home: dir,
			env: { PATH: "/usr/bin:/bin", GO: go },
			print: async (text) => {
				await writeFile(`${go}.new`, text);
				await rename(`${go}.new`, `${go}.say`);
			},
			finish: async (code) => {
				if (!existsSync(go)) await writeFile(go, `${code}`);
			},
		};
	}),
];

for (const suite of suites) {
	describe(`SetupProcesses (${suite.name})`, () => {
		for (const c of suite.cases) {
			test(c.name, c.run);
		}
	});
}
