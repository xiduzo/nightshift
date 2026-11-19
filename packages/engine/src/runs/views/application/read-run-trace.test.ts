import { describe, expect, test } from "bun:test";
import { runRecord } from "../../access/adapters/out/in-memory-run-records";
import { inMemoryViewsPorts } from "../adapters/out/in-memory-neighbours";
import { readRunTrace } from "./read-run-trace";

/** A run as monitoring reads it, on in-memory adapters. */

describe("readRunTrace", () => {
	test("a run with events has a trace; a run with none has no trace", async () => {
		const ports = inMemoryViewsPorts();
		ports.addRun(runRecord({ id: "run-1", spaceId: "space-1" }));
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
		const read = readRunTrace(ports);
		expect(await read({ runId: "run-1" })).toMatchObject({ runId: "run-1" });
		expect(await read({ runId: "run-gone" })).toBeNull();
	});
});
