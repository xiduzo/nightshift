import { describe, expect, test } from "bun:test";
import type { Refusal } from "@nightshift/refusal";
import { NIGHT_SHIFT } from "../../../contract";
import {
	ADA,
	inMemoryMovePorts,
	SPACE,
	VIC,
} from "../adapters/out/in-memory-neighbours";
import { listMoveTargets } from "./list-move-targets";

/** The Devices a run can move to, on in-memory adapters. */

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error as Refusal,
	);

/** This computer, as the Walker of its runs. */
const HERE = "this-computer";

function setup(laptopOnline = true) {
	const ports = inMemoryMovePorts();
	const own = { thisDevice: false, hasClone: true, personId: ADA.personId };
	ports.devices.add({
		...own,
		deviceId: HERE,
		name: "this computer",
		thisDevice: true,
		online: true,
	});
	ports.devices.add({
		...own,
		deviceId: "laptop",
		name: "laptop",
		online: laptopOnline,
	});
	// Another Person's Device, through its Offers: it takes steps, never a walk.
	ports.devices.add({
		...own,
		deviceId: "theirs",
		name: "theirs",
		online: true,
		personId: "person-bea",
		offers: ["agent"],
	});
	return { ports, targets: listMoveTargets(ports) };
}

describe("the Devices a run can move to", () => {
	test("can go to the owner's other Devices that are online, never to its own Walker", async () => {
		const { ports, targets } = setup();
		ports.put({ id: "run-1" });
		const ids = async () =>
			(await targets(ADA, { runId: "run-1", spaceId: SPACE })).map(
				(d) => d.deviceId,
			);
		expect(await ids()).toEqual(["laptop"]);

		// The laptop walks it now: it can come back to this computer.
		ports.put({ id: "run-1", walkerId: "laptop" });
		expect(await ids()).toEqual([HERE]);
		// A run of another Space is not found there.
		const refused = await refusalOf(
			targets(ADA, { runId: "run-1", spaceId: "another-space" }),
		);
		expect(refused?.kind).toBe("not-found");
		expect(refused?.message).toBe("Night Shift cannot find this run.");
	});

	test("has no target while the owner's other Device is offline", async () => {
		const { ports, targets } = setup(false);
		ports.put({ id: "run-1" });
		expect(await targets(ADA, { runId: "run-1" })).toEqual([]);
	});

	test("need a Person", async () => {
		const { ports, targets } = setup();
		ports.put({ id: "run-1" });
		const refused = await refusalOf(targets(NIGHT_SHIFT, { runId: "run-1" }));
		expect(refused?.kind).toBe("signed-out");
		expect(refused?.message).toBe("Sign in to act on this run.");
	});

	test("are a Member's to see: a viewer sees them, a Person who is no Member does not find the run", async () => {
		const { ports, targets } = setup();
		ports.put({ id: "run-1" });
		expect(await targets(VIC, { runId: "run-1" })).toEqual([]);
		const refused = await refusalOf(
			targets({ personId: "person-sam", door: "session" }, { runId: "run-1" }),
		);
		expect(refused?.kind).toBe("not-found");
	});
});
