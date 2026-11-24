import { expect, test } from "bun:test";
import { project } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { FLOW_VERSION, type Flow, type Schedule } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { createFlowDocuments } from "../../../documents";
import { wireStore as createProjectFlows } from "../../../flows";
import { PROJECT_NOT_FOUND } from "../../../projects/keep";
import { ownDevice } from "../../../testing/alone-directory";
import { localSpaceId } from "../../../testing/test-support";
import { flowDocumentScheduleStore } from "./flow-document-schedule-store";
import { inMemoryPausedHere } from "./in-memory-neighbours";
import { inMemoryScheduleStore } from "./in-memory-schedule-store";
import { scheduleStoreContract } from "./schedule-store.contract";

/**
 * The contract of `ScheduleStore`, on both adapters. The real side runs
 * on libsql in memory: the flow documents of a migrated database with one
 * project row, and no folder and no git.
 */

const night: Flow = {
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	start: "work",
	nodes: [
		{
			id: "work",
			type: "command",
			position: { x: 0, y: 0 },
			command: "echo night",
			stdout: "text",
		},
	],
	edges: [],
};

scheduleStoreContract("in memory", async () => {
	const store = inMemoryScheduleStore();
	store.seed("project-1", { flows: { night: { json: night } } });
	return { store, projectId: "project-1", night, close: async () => {} };
});

/** The flows of one project on libsql in memory. */
async function projectFlows() {
	const db = await migratedDb();
	const deviceId = (await ownDevice(db)).id;
	const spaceId = await localSpaceId(db);
	await db
		.insert(project)
		.values({ id: "project-1", spaceId, name: "one", folder: false });
	const flows = createProjectFlows({
		documents: createFlowDocuments({ db }),
		// What the projects slice answers: the Space, or "not found".
		project: async (projectId) => {
			if (projectId !== "project-1") {
				throw new Refusal("not-found", PROJECT_NOT_FOUND);
			}
			return { spaceId };
		},
		deviceId,
	});
	await flows.save("project-1", "night", night);
	return flows;
}

scheduleStoreContract("the flow documents, on libsql in memory", async () => ({
	store: flowDocumentScheduleStore(await projectFlows()),
	projectId: "project-1",
	night,
	close: async () => {},
}));

test("a schedule paused here reads as off, its document keeps it, and a person ends the pause", async () => {
	const flows = await projectFlows();
	const on = {
		id: "nightly",
		flow: "night",
		inputs: {},
		cron: "0 22 * * *",
		enabled: true,
		person: "ada",
	} as Schedule;
	await flows.saveSchedules("project-1", [on]);
	const here = inMemoryPausedHere({ "project-1": ["nightly"] });
	const store = flowDocumentScheduleStore(flows, here);
	const stored = async () => (await flows.schedules("project-1")).schedules;
	const { schedules } = await store.list("project-1");
	expect(schedules).toEqual([{ ...on, enabled: false, person: undefined }]);

	await store.save("project-1", schedules);
	expect(await stored()).toEqual([on]);
	expect(here.paused["project-1"]).toEqual(["nightly"]);

	// A stop before the record changes leaves it paused.
	const turnedOn = schedules.map((s) => ({ ...s, enabled: true }));
	const broken = flowDocumentScheduleStore(flows, {
		...here,
		ended: () => Promise.reject(new Error("stop")),
	});
	await expect(broken.save("project-1", turnedOn)).rejects.toThrow("stop");
	expect((await store.list("project-1")).schedules[0]?.enabled).toBe(false);

	await store.save("project-1", turnedOn);
	expect((await store.list("project-1")).schedules).toEqual(turnedOn);
	expect(here.paused["project-1"]).toEqual([]);
});
