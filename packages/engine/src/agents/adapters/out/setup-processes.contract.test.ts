import { describe, test } from "bun:test";

import { bunSetupProcesses } from "./bun-setup-processes";
import { inMemorySetupProcesses } from "./in-memory-setup-processes";
import { setupProcessesContract } from "./setup-processes.contract";

const memory = setupProcessesContract("in-memory", () => {
	const processes = inMemorySetupProcesses();
	return {
		processes,
		finishInstall: (code) => processes.started.at(-1)?.exit(code),
		finishSignIn: (code) => processes.started.at(-1)?.exit(code),
	};
});

const bun = setupProcessesContract("bun over a fake spawn", () => {
	const processes = inMemorySetupProcesses();
	return {
		processes,
		finishInstall: (code) => processes.started.at(-1)?.exit(code),
		finishSignIn: (code) => processes.started.at(-1)?.exit(code),
	};
});

for (const suite of [memory, bun]) {
	describe(`SetupProcesses (${suite.name})`, () => {
		for (const c of suite.cases) {
			test(c.name, c.run);
		}
	});
}

void bunSetupProcesses;
