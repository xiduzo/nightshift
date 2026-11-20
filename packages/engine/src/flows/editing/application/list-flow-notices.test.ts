import { describe, expect, test } from "bun:test";
import { inMemoryEditingPorts } from "../adapters/out/in-memory-neighbours";
import { listFlowNotices } from "./list-flow-notices";

const ada = { personId: "ada", door: "session" } as const;
const notice = {
	id: "n-1",
	at: 1,
	deviceId: "laptop",
	kind: "folder-kept",
	message: "Kept.",
};

describe("listFlowNotices", () => {
	test("lists the notices of a project of the Space", async () => {
		const ports = inMemoryEditingPorts();
		ports.flows.store.seed("project", [notice]);
		expect(
			await listFlowNotices(ports)(ada, {
				spaceId: "space",
				projectId: "project",
			}),
		).toEqual([notice]);
	});

	test("a project of another Space is not found", async () => {
		const ports = inMemoryEditingPorts();
		const list = listFlowNotices(ports)(ada, {
			spaceId: "space",
			projectId: "elsewhere",
		});
		await expect(list).rejects.toThrow("This project does not exist.");
	});
});
