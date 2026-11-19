import { describe, expect, test } from "bun:test";
import type { Refusal } from "@nightshift/refusal";
import { NIGHT_SHIFT } from "../../../contract";
import type { RunRefusal } from "../../../run-status";
import {
	ADA,
	FAR,
	inMemoryActionPorts,
	SPACE,
	stateOf,
	VIC,
} from "../adapters/out/in-memory-neighbours";
import { stopRun } from "./stop-run";

/** A stop, on in-memory adapters. */

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error,
	);

function setup(reachable = true) {
	const ports = inMemoryActionPorts({ reachable });
	return { ports, stop: stopRun(ports) };
}

describe("a stop of a run this computer walks", () => {
	test("now is a Turn of the runner, by a person", async () => {
		const { ports, stop } = setup();
		ports.put({ id: "run-1" });
		await stop(ADA, { runId: "run-1", spaceId: SPACE });
		expect(ports.turns.taken).toEqual([
			{ runId: "run-1", intent: { kind: "stop", by: "person" } },
		]);
	});

	test("after the running step is logged once, and the run's watchers hear of it", async () => {
		const { ports, stop } = setup();
		ports.put({ id: "run-1" }, stateOf({ status: "running" }));
		await stop(ADA, { runId: "run-1", when: "after-step" });
		expect(ports.facts.appended.map((e) => e.type)).toEqual([
			"StopAfterStepRequested",
		]);
		expect(ports.facts.changes).toEqual(["run-1"]);
		expect(ports.turns.taken).toEqual([]);

		// The log says so already: nothing more.
		ports.put(
			{ id: "run-1" },
			stateOf({ status: "running", stopAfterStep: true }),
		);
		await stop(ADA, { runId: "run-1", when: "after-step" });
		await stop(ADA, { runId: "run-1", when: "cancel-after-step" });
		expect(ports.facts.appended.map((e) => e.type)).toEqual([
			"StopAfterStepRequested",
			"StopAfterStepCancelled",
		]);
	});

	test("after the step of a run that ended logs nothing", async () => {
		const { ports, stop } = setup();
		ports.put({ id: "run-1" }, stateOf({ status: "finished" }));
		await stop(ADA, { runId: "run-1", when: "after-step" });
		expect(ports.facts.appended).toEqual([]);
	});
});

describe("a stop of a run another Device walks", () => {
	test("travels to its Walker as run.stop, in the person's name", async () => {
		const { ports, stop } = setup();
		ports.put({ id: "run-1", walkerId: FAR });
		await stop(ADA, { runId: "run-1", spaceId: SPACE });
		await stop(ADA, { runId: "run-1", when: "after-step" });
		const to = {
			spaceId: SPACE,
			runId: "run-1",
			walkerId: FAR,
			personId: ADA.personId,
		};
		expect(ports.walkers.sent).toEqual([
			{ ...to, kind: "run.stop", payload: {} },
			{ ...to, kind: "run.stop", payload: { when: "after-step" } },
		]);
		expect(ports.turns.taken).toEqual([]);
	});

	test("of a run that ended has nothing to stop: nothing travels", async () => {
		const { ports, stop } = setup();
		ports.put({ id: "run-1", walkerId: FAR }, stateOf({ status: "stopped" }));
		await stop(ADA, { runId: "run-1" });
		expect(ports.walkers.sent).toEqual([]);
	});

	test("without a Person, or without a Host to reach, is refused", async () => {
		const { ports, stop } = setup();
		ports.put({ id: "run-1", walkerId: FAR });
		const signedOut = await refusalOf(stop(NIGHT_SHIFT, { runId: "run-1" }));
		expect((signedOut as RunRefusal).rule).toBe("signed-out");

		const far = setup(false);
		far.ports.put({ id: "run-1", walkerId: FAR });
		const unreachable = await refusalOf(far.stop(ADA, { runId: "run-1" }));
		expect((unreachable as RunRefusal).rule).toBe("walker-unreachable");
	});
});

describe("who may stop a run", () => {
	test("a viewer is refused: their role does not allow run.stop", async () => {
		const { ports, stop } = setup();
		ports.put({ id: "run-1" });
		const refused = await refusalOf(stop(VIC, { runId: "run-1" }));
		expect(refused).toBeInstanceOf(ports.RoleRefusal);
		expect(ports.turns.taken).toEqual([]);
	});

	test("a run of another Space, or of a Space the Person is not in, is not found", async () => {
		const { ports, stop } = setup();
		ports.put({ id: "run-1" });
		ports.put({ id: "run-2", spaceId: "space-2" });
		for (const [actor, runId, spaceId] of [
			[ADA, "run-1", "space-2"],
			[ADA, "run-2", undefined],
			[{ personId: "person-gone" }, "run-1", undefined],
		] as const) {
			const refused = await refusalOf(stop(actor, { runId, spaceId }));
			expect((refused as Refusal).kind).toBe("not-found");
			expect((refused as Refusal).message).toBe(
				"Night Shift cannot find this run.",
			);
		}
		expect(ports.turns.taken).toEqual([]);
	});

	test("Night Shift needs no role", async () => {
		const { ports, stop } = setup();
		ports.put({ id: "run-1", spaceId: "space-2" });
		await stop(NIGHT_SHIFT, { runId: "run-1" });
		expect(ports.turns.taken).toHaveLength(1);
	});
});
