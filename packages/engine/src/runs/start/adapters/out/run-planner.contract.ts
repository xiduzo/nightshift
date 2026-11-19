import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { FlowNode } from "@nightshift/flows";
import type { OwnDevice, Placement } from "../../../../contract";
import type { Device } from "../../../../device";
import type { RunPlanner } from "../../application/ports";

/** One adapter of `RunPlanner` to test, over the Devices of one Replica. */
export type RunPlannerUnderTest = {
	planner: RunPlanner;
	/** The project's runs, oldest first, each on its Device. */
	ran(projectId: string, deviceIds: readonly string[]): Promise<void>;
	/** A Device of an older Night Shift, which cannot read the flow, named `name`. */
	older(name: string): Device;
	/** A Device of this Night Shift. */
	current(): Device;
	/** The Devices the peers offer a person: what `placements` and `devicesFor` answer. */
	offered: { placements: Placement[]; devices: OwnDevice[] };
	close(): Promise<void>;
};

/** A Gate that a person answers: every Device of this Night Shift can take it. */
const GATE = {
	id: "ship",
	type: "decision",
	position: { x: 0, y: 0 },
	prompt: "Ship it?",
	options: [{ name: "yes" }, { name: "no" }],
	by: "person",
} as unknown as FlowNode;

/**
 * What every adapter of `RunPlanner` does.
 * `run-planner.contract.test.ts` runs it on the in-memory adapter and on
 * the one over Placement.
 */
export function runPlannerContract(
	name: string,
	make: () => Promise<RunPlannerUnderTest>,
): void {
	describe(`RunPlanner contract: ${name}`, () => {
		let under: RunPlannerUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("a project without runs has no latest Device, else the Device of its latest run", async () => {
			expect(await under.planner.lastRunDevice("project-1")).toBeNull();
			await under.ran("project-1", ["laptop", "desktop"]);
			expect(await under.planner.lastRunDevice("project-1")).toBe("desktop");
			expect(await under.planner.lastRunDevice("project-2")).toBeNull();
		});

		test("a Device that cannot take the nodes says why, one that can says nothing", async () => {
			expect(await under.planner.misfit([GATE], under.current())).toBeNull();
			expect(await under.planner.misfit([GATE], under.older("old-box"))).toBe(
				"old-box runs an older version of Night Shift. Update Night Shift on old-box.",
			);
		});

		test("the Devices a person chooses from are the ones the peers offer", async () => {
			expect(
				await under.planner.placements("space-1", "person-ada", "project-1"),
			).toEqual(under.offered.placements);
			expect(
				await under.planner.devicesFor("space-1", "person-ada", "project-1"),
			).toEqual(under.offered.devices);
		});
	});
}
