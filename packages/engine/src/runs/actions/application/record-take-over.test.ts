import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import type { DerivedSession, RunState } from "../../../log";
import type { RunRefusal } from "../../../run-status";
import {
	ADA,
	FAR,
	inMemoryActionPorts,
	SPACE,
	stateOf,
	VIC,
} from "../adapters/out/in-memory-neighbours";
import { recordTakeOver } from "./record-take-over";

/** A take-over by hand, on in-memory adapters. */

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error,
	);

/** A run that waits at a Gate after an agent session on `step-1`, in a walk that began at seq 0. */
function afterAgent(takeOvers: RunState["takeOvers"] = []): RunState {
	const session = {
		harness: "claude-code",
		harnessSessionId: "harness-1",
		stepId: "step-1",
	} as DerivedSession;
	return stateOf({
		status: "waiting",
		walk: { seq: 0, at: 0 },
		sessions: new Map([["session-1", session]]),
		takeOvers,
	});
}

function setup() {
	const ports = inMemoryActionPorts();
	return { ports, takeOver: recordTakeOver(ports) };
}

describe("a take-over", () => {
	test("is logged once on the step of the last agent session, in the person's name", async () => {
		const { ports, takeOver } = setup();
		ports.put({ id: "run-1" }, afterAgent());
		await takeOver(ADA, { runId: "run-1", spaceId: SPACE });
		const logged = ports.facts.appended;
		expect(
			logged.map(({ type, stepId, payload }) => ({ type, stepId, payload })),
		).toEqual([
			{
				type: "RunTakenOver",
				stepId: "step-1",
				payload: { by: ADA.personId, harness: "claude-code" },
			},
		]);

		// A second copy of the command adds nothing. Night Shift is another hand.
		ports.put(
			{ id: "run-1" },
			afterAgent(logged as unknown as RunState["takeOvers"]),
		);
		await takeOver(ADA, { runId: "run-1" });
		expect(ports.facts.appended).toHaveLength(1);
		await takeOver(NIGHT_SHIFT, { runId: "run-1" });
		expect(ports.facts.appended.map((e) => e.payload)).toEqual([
			{ by: ADA.personId, harness: "claude-code" },
			{ by: null, harness: "claude-code" },
		]);
	});

	test("of a run without an agent session logs nothing", async () => {
		const { ports, takeOver } = setup();
		ports.put({ id: "run-1" }, stateOf({ status: "waiting" }));
		await takeOver(ADA, { runId: "run-1" });
		expect(ports.facts.appended).toEqual([]);
	});

	test("of a run another Device walks is refused: only its Walker logs it", async () => {
		const { ports, takeOver } = setup();
		ports.put({ id: "run-1", walkerId: FAR }, afterAgent());
		const refused = await refusalOf(takeOver(ADA, { runId: "run-1" }));
		expect((refused as RunRefusal).rule).toBe("walked-elsewhere");
		expect(ports.facts.appended).toEqual([]);
		expect(ports.walkers.sent).toEqual([]);
	});

	test("by a viewer is refused", async () => {
		const { ports, takeOver } = setup();
		ports.put({ id: "run-1" }, afterAgent());
		const refused = await refusalOf(takeOver(VIC, { runId: "run-1" }));
		expect(refused).toBeInstanceOf(ports.RoleRefusal);
		expect(ports.facts.appended).toEqual([]);
	});
});
