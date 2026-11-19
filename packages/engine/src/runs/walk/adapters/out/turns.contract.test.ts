import type { RunRow } from "../../../../log";
import { runEvents } from "../../../../testing";
import { agent, flowOf, startRun, testRunner } from "../../../../testing/graph";
import { createSandbox } from "../../../../testing/test-support";
import { inMemoryTurns } from "./in-memory-turns";
import { runnerTurns } from "./runner-turns";
import { turnsContract } from "./turns.contract";

/**
 * The contract of `Turns`, on both adapters. The real side is the runner
 * over a sandbox (a database file, a folder and a git repository), with
 * one run that started and that no drive holds.
 */

turnsContract("in memory", async () => {
	const turns = inMemoryTurns();
	const log = runEvents("run-1").push("RunStarted", {
		projectId: "project-1",
		flowName: null,
		title: "test",
		start: "worker",
		inputs: {},
	});
	turns.set("run-1", {
		row: { id: "run-1", spaceId: "space-1", walkerId: "here" } as RunRow,
		runState: log.state(),
		active: false,
	});
	return {
		turns,
		runId: "run-1",
		status: async () => log.state().status,
		handedOn: async () => turns.taken.length,
		release: async () => turns.release(),
		close: async () => {},
	};
});

turnsContract("the runner, on a sandbox", async () => {
	const sandbox = await createSandbox();
	const h = await startRun(sandbox, flowOf([agent("worker", "Build it")], []));
	const runner = testRunner(h);
	return {
		turns: runnerTurns(runner),
		runId: h.runId,
		status: async () => (await h.log.state(h.runId)).status,
		handedOn: async () => (await h.events()).length,
		release: () => runner.release(),
		async close() {
			await runner.release();
			await sandbox.cleanup();
		},
	};
});
