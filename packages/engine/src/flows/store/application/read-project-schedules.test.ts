import { describe, expect, test } from "bun:test";
import { scheduleSchema } from "@nightshift/flows";
import { inMemoryStorePorts } from "../adapters/out/in-memory-neighbours";
import { readProjectSchedules } from "./read-project-schedules";

const nightly = scheduleSchema.parse({
	id: "nightly",
	flow: "build",
	cron: "0 3 * * *",
});

describe("readProjectSchedules", () => {
	test("checks each schedule against the flows as a read gives them", async () => {
		const ports = inMemoryStorePorts();
		await ports.store.saveSchedules("project", [nightly]);
		const read = await readProjectSchedules(ports)({ projectId: "project" });
		expect(read.path).toBe("schedules");
		expect(read.schedules).toEqual([nightly]);
		// The flow "build" does not exist: the schedule has a problem.
		expect(read.issues.length).toBeGreaterThan(0);
		expect(ports.store.reads).toEqual([
			{ projectId: "project", deviceId: "laptop", spaceId: "space" },
		]);
	});

	test("without validate, it reads no flow and finds no problem", async () => {
		const ports = inMemoryStorePorts();
		await ports.store.saveSchedules("project", [nightly]);
		const read = await readProjectSchedules(ports)({
			projectId: "project",
			validate: false,
		});
		expect(read.issues).toEqual([]);
		expect(ports.store.reads).toEqual([]);
	});

	test("refuses a Project this Replica does not have", async () => {
		const ports = inMemoryStorePorts();
		const read = readProjectSchedules(ports)({ projectId: "gone" });
		await expect(read).rejects.toThrow("This project does not exist.");
	});
});
