import { expect, test } from "bun:test";
import {
	inMemoryPlacement,
	OWNER,
	PROJECT,
	placedRun,
	SELF,
	SPACE,
	WALKER,
} from "../adapters/out/in-memory-neighbours";

import { reachDevice } from "./reach-device";

test("this computer, by either of its ids, is the Device as the run reaches it", () => {
	const { ports, reached } = inMemoryPlacement();
	for (const id of [SELF, WALKER]) {
		expect(reachDevice(ports)(id, placedRun()).name).toBe(
			"This computer for run-1",
		);
	}
	expect(reached).toEqual([]);
});

test("another Device is reached for the Person of the plan", () => {
	const { ports, reached } = inMemoryPlacement();
	expect(reachDevice(ports)("laptop", placedRun()).id).toBe("laptop");
	expect(reached).toEqual([
		{
			id: "laptop",
			starter: true,
			forRun: {
				spaceId: SPACE,
				projectId: PROJECT,
				personId: OWNER,
				runId: "run-1",
			},
		},
	]);
});

test("a run with no starter reaches no other Device", () => {
	const { ports, reached } = inMemoryPlacement();
	reachDevice(ports)("laptop", placedRun({ personId: null }));
	expect(reached).toMatchObject([{ id: "laptop", starter: false }]);
});

test("another Device has the name asked, else the plan's, else a plain one", () => {
	const reach = reachDevice(inMemoryPlacement().ports);
	const run = placedRun({ devices: { b: { id: "b", name: "studio" } } });
	expect(reach("b", run, "asked").name).toBe("asked");
	expect(reach("b", run).name).toBe("studio");
	expect(reach("c", run).name).toBe("The device of this step");
});
