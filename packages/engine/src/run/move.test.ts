import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../contract";
import type { RunRefusal } from "../run-status";
import {
	ADA,
	FAR,
	inMemoryActionPorts,
	SPACE,
	stateOf,
} from "../runs/actions/adapters/out/in-memory-neighbours";
import { createMovePath } from "./move";

/**
 * The move path, on the in-memory adapters of `runs/`: on a run another
 * Device walks, the move travels to its Walker as `run.move`. The move of
 * a run this computer walks is proven whole in `test/engine/move.test.ts`.
 * Lane R5 moves these tests with the path to `runs/move/`.
 */

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error,
	);

function setup() {
	const ports = inMemoryActionPorts();
	const unused = () => {
		throw new Error("Not in this test.");
	};
	const path = createMovePath({
		openRun: ports.openRun,
		walk: ports,
		db: undefined as never,
		archive: { keepWalk: unused },
		walks: { exportWalk: unused },
		device: { id: "this-computer" },
		placement: {
			moveTo: unused,
			deviceById: unused,
			devicesFor: unused,
		},
	});
	return { ports, path };
}

describe("a move of a run another Device walks", () => {
	test("travels to its Walker as run.move, in the person's name", async () => {
		const { ports, path } = setup();
		ports.put({ id: "run-1", walkerId: FAR });
		await path.move(ADA, { runId: "run-1", spaceId: SPACE, to: "desk" });
		expect(ports.walkers.sent).toEqual([
			{
				kind: "run.move",
				payload: { to: "desk" },
				spaceId: SPACE,
				runId: "run-1",
				walkerId: FAR,
				personId: ADA.personId,
			},
		]);
	});

	test("needs a Person, and is refused here by the status rule before it travels", async () => {
		const { ports, path } = setup();
		ports.put({ id: "run-1", walkerId: FAR }, stateOf({ status: "finished" }));
		const signedOut = await refusalOf(
			path.move(NIGHT_SHIFT, { runId: "run-1", to: "desk" }),
		);
		expect((signedOut as RunRefusal).rule).toBe("signed-out");
		const ended = await refusalOf(
			path.move(ADA, { runId: "run-1", to: "desk" }),
		);
		expect((ended as RunRefusal).rule).toBe("not-now");
		expect(ports.walkers.sent).toEqual([]);
	});
});

test("a move of a run this computer walks to this computer is refused", async () => {
	const { ports, path } = setup();
	ports.put({ id: "run-1" });
	const refused = await refusalOf(
		path.move(ADA, { runId: "run-1", to: "this-computer" }),
	);
	expect((refused as RunRefusal).rule).toBe("walks-here");
	expect((refused as RunRefusal).message).toBe(
		"This run already runs on this computer.",
	);
});
