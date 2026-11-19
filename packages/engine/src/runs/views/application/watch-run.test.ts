import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import type { RunStreamItem } from "../../../read";
import { runRecord } from "../../access/adapters/out/in-memory-run-records";
import { inMemoryViewsPorts } from "../adapters/out/in-memory-neighbours";
import { watchRun } from "./watch-run";

/** The watch of a run for an actor, on in-memory adapters. */

const SPACE = "space-1";
const ADA = { personId: "person-ada", door: "session" as const };

function setup() {
	const ports = inMemoryViewsPorts();
	ports.addRun(runRecord({ id: "run-1", spaceId: SPACE }));
	ports.views.append({
		type: "RunStarted",
		runId: "run-1",
		payload: { projectId: "project-1", flowName: "f", title: "t", start: "a" },
	});
	return { ports, watch: watchRun(ports) };
}

/** The first item of a watch, then the watch stops. */
async function firstOf(stream: AsyncGenerator<RunStreamItem>) {
	const first = await stream.next();
	await stream.return(undefined);
	return first.value;
}

describe("watchRun", () => {
	test("Night Shift and a Member watch the run: its status comes first", async () => {
		const { ports, watch } = setup();
		const stop = new AbortController();
		expect(
			await firstOf(
				await watch(NIGHT_SHIFT, { runId: "run-1", signal: stop.signal }),
			),
		).toEqual({ kind: "status", status: "running" });
		ports.access.members.join(SPACE, ADA.personId, "viewer");
		expect(
			await firstOf(
				await watch(ADA, {
					runId: "run-1",
					spaceId: SPACE,
					afterSeq: 0,
					signal: stop.signal,
				}),
			),
		).toEqual({ kind: "status", status: "running" });
		stop.abort();
	});

	test("a run the Person may not see is refused before the stream begins", async () => {
		const { watch } = setup();
		await expect(
			watch(ADA, { runId: "run-1", signal: new AbortController().signal }),
		).rejects.toMatchObject({
			kind: "not-found",
			message: "Night Shift cannot find this run.",
		});
	});

	test("a watch that was stopped before it began sends nothing", async () => {
		const { watch } = setup();
		const stop = new AbortController();
		stop.abort();
		const stream = await watch(NIGHT_SHIFT, {
			runId: "run-1",
			signal: stop.signal,
		});
		expect((await stream.next()).done).toBe(true);
	});
});
