import { describe, expect, test } from "bun:test";
import type { RunState } from "../../../log";
import { RunRefusal } from "../../../run-status";
import {
	ADA,
	FAR,
	inMemoryActionPorts,
	SPACE,
	stateOf,
	VIC,
} from "../adapters/out/in-memory-neighbours";
import { sendSignal } from "./send-signal";

/** A Signal to a run, on in-memory adapters. */

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error,
	);

/** A Wait node's sleep for the Signal `go`, as the log folds it. */
const waits = [
	{ stepId: "step-1", payload: { signal: "go" } },
] as unknown as RunState["waits"];

/** A run that sleeps in a Wait node for the Signal `go`. */
const sleeping = stateOf({ status: "sleeping", waits });

/** A run that waits at a Gate, beside a Wait node for the Signal `go`. */
const waitingBeside = stateOf({ status: "waiting", waits });

function setup() {
	const ports = inMemoryActionPorts();
	return { ports, signal: sendSignal(ports) };
}

describe("a Signal to a run this computer walks", () => {
	test("wakes it early, as a Turn of the runner", async () => {
		const { ports, signal } = setup();
		ports.put({ id: "run-1" }, sleeping);
		await signal(ADA, { runId: "run-1", spaceId: SPACE, name: "go" });
		expect(ports.turns.taken).toEqual([
			{
				runId: "run-1",
				intent: { kind: "wake", early: true, signal: "go" },
			},
		]);
	});

	test("wakes the Wait beside an open Gate, as a Turn of the runner", async () => {
		const { ports, signal } = setup();
		ports.put({ id: "run-1" }, waitingBeside);
		await signal(ADA, { runId: "run-1", spaceId: SPACE, name: "go" });
		expect(ports.turns.taken).toEqual([
			{
				runId: "run-1",
				intent: { kind: "wake", early: true, signal: "go" },
			},
		]);
	});

	test("of another name is refused inside the Turn", async () => {
		const { ports, signal } = setup();
		ports.put({ id: "run-1" }, sleeping);
		const refused = await refusalOf(
			signal(ADA, { runId: "run-1", name: "stop" }),
		);
		expect((refused as RunRefusal).rule).toBe("wrong-signal");
		expect(ports.turns.taken).toEqual([]);
	});
});

describe("a Signal to a run another Device walks", () => {
	test("travels to its Walker as signal.send", async () => {
		const { ports, signal } = setup();
		ports.put({ id: "run-1", walkerId: FAR }, sleeping);
		await signal(ADA, { runId: "run-1", name: "go" });
		expect(ports.walkers.sent).toEqual([
			{
				kind: "signal.send",
				payload: { name: "go" },
				spaceId: SPACE,
				runId: "run-1",
				walkerId: FAR,
				personId: ADA.personId,
			},
		]);
	});

	test("travels when the run waits at a Gate beside a Wait for it", async () => {
		const { ports, signal } = setup();
		ports.put({ id: "run-1", walkerId: FAR }, waitingBeside);
		await signal(ADA, { runId: "run-1", name: "go" });
		expect(ports.walkers.sent).toHaveLength(1);
	});

	test("is refused here, before it travels, when the log says the run waits only at a Gate", async () => {
		const { ports, signal } = setup();
		ports.put({ id: "run-1", walkerId: FAR }, stateOf({ status: "waiting" }));
		const refused = await refusalOf(
			signal(ADA, { runId: "run-1", name: "go" }),
		);
		expect(refused).toBeInstanceOf(RunRefusal);
		expect(ports.walkers.sent).toEqual([]);
	});
});

test("a viewer may not send a Signal", async () => {
	const { ports, signal } = setup();
	ports.put({ id: "run-1" }, sleeping);
	const refused = await refusalOf(signal(VIC, { runId: "run-1", name: "go" }));
	expect(refused).toBeInstanceOf(ports.RoleRefusal);
});
