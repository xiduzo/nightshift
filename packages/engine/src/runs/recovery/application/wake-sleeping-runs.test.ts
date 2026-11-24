import { describe, expect, test } from "bun:test";
import type { EnginePayloads, WaitReason } from "../../../log";
import { eventsOf } from "../adapters/out/in-memory-neighbours";
import { recoveryPorts } from "../test-support";
import { wakeSleepingRuns } from "./wake-sleeping-runs";

/** The wakes of sleeping runs, over a database in memory. */

const started = {
	projectId: "project-1",
	flowName: "f",
	title: "f",
	start: "a",
} as EnginePayloads["RunStarted"];

/** A run whose step `s1` sleeps for `reason`, or runs when `reason` is null. */
function sleepingFor(runId: string, reason: WaitReason | null) {
	const log = eventsOf(runId).push("RunStarted", started).push(
		"StepStarted",
		{
			nodeId: "a",
			nodeType: "lease",
			visit: 1,
			transcriptPath: "/t/s1",
			logPath: null,
			scope: null,
		},
		{ stepId: "s1" },
	);
	if (reason) {
		log.push(
			"WaitStarted",
			{ reason, until: null, message: "It waits.", since: 1 },
			{ stepId: "s1" },
		);
	}
	return log.events;
}

async function setup() {
	const ports = await recoveryPorts();
	await ports.addRun("run-lease", sleepingFor("run-lease", "lease"));
	await ports.addRun(
		"run-offline",
		sleepingFor("run-offline", "device-offline"),
	);
	await ports.addRun("run-busy", sleepingFor("run-busy", null));
	await ports.addRun("run-far", sleepingFor("run-far", "lease"), {
		walkerId: "device-far",
	});
	return { ports, wake: wakeSleepingRuns(ports) };
}

describe("wakeSleepingRuns", () => {
	test("a freed lease wakes the runs here that wait for a lease, by the daemon", async () => {
		const { ports, wake } = await setup();
		await wake("lease");
		expect(ports.turns.taken).toEqual([
			{
				runId: "run-lease",
				intent: { kind: "wake", early: true, by: "daemon" },
			},
		]);
	});

	test("a Device that is back wakes the runs here that sleep because it was offline", async () => {
		const { ports, wake } = await setup();
		await wake("device-offline");
		expect(ports.turns.taken.map((t) => t.runId)).toEqual(["run-offline"]);
	});

	test("a wake that fails changes nothing, and the call does not fail", async () => {
		const { ports, wake } = await setup();
		ports.turns.release();
		await wake("lease");
		expect(ports.turns.taken).toEqual([]);
	});
});
