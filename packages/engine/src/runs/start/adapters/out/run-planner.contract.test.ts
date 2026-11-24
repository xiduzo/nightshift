import { project, run } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { FLOW_VERSION } from "@nightshift/flows";
import { asDate } from "@nightshift/time";
import type { OwnDevice, Placement } from "../../../../contract";
import type { Capabilities, Device } from "../../../../device";
import { localSpaceId } from "../../../../testing/test-support";
import { inMemoryRunPlanner } from "./in-memory-run-planner";
import { placementRunPlanner } from "./placement-run-planner";
import { runPlannerContract } from "./run-planner.contract";

/**
 * The contract of `RunPlanner`, on both adapters. The real side runs on
 * libsql in memory (the runs of a project), with the fit check of
 * Placement over Devices that answer their capabilities, and peers that
 * offer two Devices.
 */

const offered: { placements: Placement[]; devices: OwnDevice[] } = {
	placements: [{ deviceId: "laptop", name: "Laptop", thisDevice: false }],
	devices: [
		{
			deviceId: "laptop",
			name: "Laptop",
			thisDevice: false,
			online: true,
			hasClone: true,
		},
	],
};

/** A Device that answers its capabilities: of this Night Shift, or of an older one. */
function deviceOf(name: string, flowVersion: number): Device {
	const capabilities: Capabilities = {
		elsewhere: name,
		harnesses: [],
		connections: [],
		clis: [],
		programs: {},
		profiles: {},
		decider: null,
		flowVersion,
		testRuns: true,
	};
	return {
		id: name,
		name,
		capabilities: async () => capabilities,
	} as unknown as Device;
}

runPlannerContract("in memory", async () => {
	const planner = inMemoryRunPlanner();
	planner.offer(offered);
	return {
		planner,
		ran: async (projectId, deviceIds) => {
			const last = deviceIds.at(-1);
			if (last) planner.ranOn(projectId, last);
		},
		older: (name) => {
			planner.unfit(
				name,
				`${name} runs an older version of Night Shift. Update Night Shift on ${name}.`,
			);
			return deviceOf(name, 1);
		},
		current: () => deviceOf("new-box", FLOW_VERSION),
		offered,
		close: async () => {},
	};
});

runPlannerContract("over Placement, on libsql in memory", async () => {
	const db = await migratedDb();
	const spaceId = await localSpaceId(db);
	await db.insert(project).values([
		{ id: "project-1", spaceId, name: "one", folder: false },
		{ id: "project-2", spaceId, name: "two", folder: false },
	]);
	const planner = placementRunPlanner({
		db,
		devices: {
			plan: async () => {
				throw new Error("The contract plans no run.");
			},
			placements: async () => offered.placements,
			devicesFor: async () => offered.devices,
		},
	});
	let runs = 0;
	return {
		planner,
		async ran(projectId, deviceIds) {
			for (const deviceId of deviceIds) {
				runs++;
				await db.insert(run).values({
					id: `run-${runs}`,
					spaceId,
					projectId,
					flow: "{}",
					title: "test",
					worktreePath: "",
					branch: "",
					baseRef: "",
					walkerId: "walker",
					deviceId,
					createdAt: asDate(runs * 1_000),
				});
			}
		},
		older: (name) => deviceOf(name, 1),
		current: () => deviceOf("new-box", FLOW_VERSION),
		offered,
		close: async () => {},
	};
});
