import { describe, expect, test } from "bun:test";
import { inMemoryStorePorts } from "../adapters/out/in-memory-neighbours";
import { listProjectFlowNotices } from "./list-project-flow-notices";

const notice = {
	id: "n-1",
	at: 1,
	deviceId: "laptop",
	kind: "folder-kept",
	message: "Kept.",
};

describe("listProjectFlowNotices", () => {
	test("lists the notices of the project's flows", async () => {
		const ports = inMemoryStorePorts();
		ports.store.seed("project", [notice]);
		expect(
			await listProjectFlowNotices(ports)({ projectId: "project" }),
		).toEqual([notice]);
	});

	test("refuses a Project this Replica does not have", async () => {
		const ports = inMemoryStorePorts();
		const list = listProjectFlowNotices(ports)({ projectId: "gone" });
		await expect(list).rejects.toThrow("This project does not exist.");
	});
});
