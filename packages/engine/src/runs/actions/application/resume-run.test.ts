import { describe, expect, test } from "bun:test";
import type { Refusal } from "@nightshift/refusal";
import type { RunRefusal } from "../../../run-status";
import {
	ADA,
	FAR,
	inMemoryActionPorts,
	SPACE,
	stateOf,
	VIC,
} from "../adapters/out/in-memory-neighbours";
import { resumeRun } from "./resume-run";

/** A resume, on in-memory adapters. */

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error,
	);

function setup() {
	const ports = inMemoryActionPorts();
	return { ports, resume: resumeRun(ports) };
}

const stopped = stateOf({ status: "stopped" });

describe("a resume of a run this computer walks", () => {
	test("is a Turn of the runner, by a person, with the prompt", async () => {
		const { ports, resume } = setup();
		ports.put({ id: "run-1" }, stopped);
		await resume(ADA, { runId: "run-1", spaceId: SPACE });
		await resume(ADA, { runId: "run-1", prompt: "Go on." });
		expect(ports.turns.taken).toEqual([
			{ runId: "run-1", intent: { kind: "resume", by: "person" } },
			{
				runId: "run-1",
				intent: { kind: "resume", by: "person", prompt: "Go on." },
			},
		]);
	});

	test("of a run that still runs is refused inside the Turn", async () => {
		const { ports, resume } = setup();
		ports.put({ id: "run-1" }, stateOf({ status: "running" }));
		const refused = await refusalOf(resume(ADA, { runId: "run-1" }));
		expect((refused as RunRefusal).rule).toBe("not-now");
		expect((refused as RunRefusal).message).toBe(
			"This run is still running. Stop it or wait for it to end.",
		);
		expect(ports.turns.taken).toEqual([]);
	});

	test("is refused while Night Shift moves the projects of its Space", async () => {
		const { ports, resume } = setup();
		ports.put({ id: "run-1" }, stopped);
		const release = await ports.holds.hold(SPACE);
		const refused = await refusalOf(resume(ADA, { runId: "run-1" }));
		expect((refused as Refusal).kind).toBe("unavailable");
		expect((refused as Refusal).message).toBe(
			"Night Shift moves the projects of this Space now. Try again in a minute.",
		);
		release();
		await resume(ADA, { runId: "run-1" });
		expect(ports.turns.taken).toHaveLength(1);
	});
});

describe("a resume of a run another Device walks", () => {
	test("travels to its Walker as run.resume, once", async () => {
		const { ports, resume } = setup();
		ports.put({ id: "run-1", walkerId: FAR }, stopped);
		await resume(ADA, { runId: "run-1", prompt: "Go on." });
		expect(ports.walkers.sent).toEqual([
			{
				kind: "run.resume",
				payload: { prompt: "Go on." },
				spaceId: SPACE,
				runId: "run-1",
				walkerId: FAR,
				personId: ADA.personId,
			},
		]);
		// One is on its way: a second is refused before it travels.
		const refused = await refusalOf(resume(ADA, { runId: "run-1" }));
		expect((refused as RunRefusal).rule).toBe("not-now");
		expect((refused as RunRefusal).message).toBe(
			"A resume of this run is already on its way to the device that runs it.",
		);
		expect(ports.walkers.sent).toHaveLength(1);
	});

	test("is refused here by the status rule, before it travels", async () => {
		const { ports, resume } = setup();
		ports.put({ id: "run-1", walkerId: FAR }, stateOf({ status: "waiting" }));
		const refused = await refusalOf(resume(ADA, { runId: "run-1" }));
		expect((refused as RunRefusal).rule).toBe("not-now");
		expect(ports.walkers.sent).toEqual([]);
	});
});

test("a viewer may not resume a run", async () => {
	const { ports, resume } = setup();
	ports.put({ id: "run-1" }, stopped);
	const refused = await refusalOf(resume(VIC, { runId: "run-1" }));
	expect(refused).toBeInstanceOf(ports.RoleRefusal);
	expect(ports.turns.taken).toEqual([]);
});
