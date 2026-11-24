import { describe, expect, test } from "bun:test";
import { scheduleSchema } from "@nightshift/flows";
import { inMemoryStorePorts } from "../adapters/out/in-memory-neighbours";
import { saveProjectSchedules } from "./save-project-schedules";

const nightly = scheduleSchema.parse({
	id: "nightly",
	flow: "build",
	cron: "0 3 * * *",
});

describe("saveProjectSchedules", () => {
	test("saves the schedules with their problems, then checks them against the flows", async () => {
		const ports = inMemoryStorePorts();
		const issues = await saveProjectSchedules(ports)({
			projectId: "project",
			schedules: [nightly],
		});
		expect((await ports.store.schedules("project")).schedules).toEqual([
			nightly,
		]);
		expect(issues.length).toBeGreaterThan(0);
		expect(ports.store.reads).toEqual(["project"]);
	});

	test("refuses a Project this Replica does not have, and saves nothing", async () => {
		const ports = inMemoryStorePorts();
		const save = saveProjectSchedules(ports)({
			projectId: "gone",
			schedules: [nightly],
		});
		await expect(save).rejects.toThrow("This project does not exist.");
		expect((await ports.store.schedules("gone")).schedules).toEqual([]);
	});
});
