import { describe, expect, test } from "bun:test";
import { runRecord } from "../../../access/adapters/out/in-memory-run-records";
import { inMemoryViewsPorts } from "../adapters/out/in-memory-neighbours";
import { readRunHere } from "./read-run-here";

/** Where a run is and what it does, on in-memory adapters. */

describe("readRunHere", () => {
	test("a run walked here, and one walked and placed elsewhere", async () => {
		const ports = inMemoryViewsPorts();
		ports.addRun(runRecord({ id: "run-1", spaceId: "space-1" }));
		ports.addRun(
			runRecord({
				id: "run-2",
				spaceId: "space-1",
				walkerId: "device-far",
				deviceId: "device-far",
			}),
		);
		ports.views.append({
			type: "RunStarted",
			runId: "run-1",
			payload: {
				projectId: "project-1",
				flowName: "f",
				title: "t",
				start: "a",
			},
		});
		const read = readRunHere(ports);
		expect(await read({ runId: "run-1" })).toEqual({
			id: "run-1",
			status: "running",
			wakeAt: null,
			waitReason: null,
			walkedHere: true,
			stepsHere: true,
		});
		expect(await read({ runId: "run-2" })).toMatchObject({
			walkedHere: false,
			stepsHere: false,
		});
	});

	test("a run this Replica does not have is null", async () => {
		const read = readRunHere(inMemoryViewsPorts());
		expect(await read({ runId: "run-gone" })).toBeNull();
	});
});
