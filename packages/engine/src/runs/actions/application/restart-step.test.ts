import { describe, expect, test } from "bun:test";
import type { Refusal } from "@nightshift/refusal";
import type { DerivedStep } from "../../../log";
import type { RunRefusal } from "../../../run-status";
import {
	ADA,
	FAR,
	inMemoryActionPorts,
	SPACE,
	stateOf,
	VIC,
} from "../adapters/out/in-memory-neighbours";
import { restartStep } from "./restart-step";

/** A restart of the running step, on in-memory adapters. */

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error,
	);

function setup() {
	const ports = inMemoryActionPorts();
	return { ports, restart: restartStep(ports) };
}

/** A run that runs `step-2`; `step-1` ended. */
const running = stateOf({
	status: "running",
	steps: new Map(
		[
			{ id: "step-1", endedAt: 10 },
			{ id: "step-2", endedAt: null },
		].map((s) => [s.id, s as DerivedStep]),
	),
});

describe("a restart of a run this computer walks", () => {
	test("is one Turn of the runner, by a person", async () => {
		const { ports, restart } = setup();
		ports.put({ id: "run-1" }, running);
		await restart(ADA, { runId: "run-1", spaceId: SPACE, stepId: "step-2" });
		await restart(ADA, { runId: "run-1", prompt: "Again." });
		expect(ports.turns.taken).toEqual([
			{ runId: "run-1", intent: { kind: "restart", by: "person" } },
			{
				runId: "run-1",
				intent: { kind: "restart", by: "person", prompt: "Again." },
			},
		]);
	});

	test("of a step that ended, or while no step runs, is refused inside the Turn", async () => {
		const { ports, restart } = setup();
		ports.put({ id: "run-1" }, running);
		const ended = await refusalOf(
			restart(ADA, { runId: "run-1", stepId: "step-1" }),
		);
		expect((ended as RunRefusal).rule).toBe("step-ended");
		ports.put({ id: "run-2" }, stateOf({ status: "running" }));
		const none = await refusalOf(restart(ADA, { runId: "run-2" }));
		expect((none as RunRefusal).rule).toBe("no-step");
		expect(ports.turns.taken).toEqual([]);
	});

	test("is refused while Night Shift moves the projects of its Space", async () => {
		const { ports, restart } = setup();
		ports.put({ id: "run-1" }, running);
		await ports.holds.hold(SPACE);
		const refused = await refusalOf(restart(ADA, { runId: "run-1" }));
		expect((refused as Refusal).kind).toBe("unavailable");
		expect(ports.turns.taken).toEqual([]);
	});
});

test("only the Walker restarts: a run another Device walks is refused, and nothing travels", async () => {
	const { ports, restart } = setup();
	ports.put({ id: "run-1", walkerId: FAR }, running);
	const refused = await refusalOf(restart(ADA, { runId: "run-1" }));
	expect((refused as RunRefusal).rule).toBe("walked-elsewhere");
	expect((refused as RunRefusal).message).toBe(
		"Another device runs this run. Try again on that device.",
	);
	expect(ports.walkers.sent).toEqual([]);
});

test("a viewer may not restart a step", async () => {
	const { ports, restart } = setup();
	ports.put({ id: "run-1" }, running);
	const refused = await refusalOf(restart(VIC, { runId: "run-1" }));
	expect(refused).toBeInstanceOf(ports.RoleRefusal);
});
