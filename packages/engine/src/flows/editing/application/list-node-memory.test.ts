import { describe, expect, test } from "bun:test";
import { inMemoryEditingPorts } from "../adapters/out/in-memory-neighbours";
import { listNodeMemory } from "./list-node-memory";

const ada = { personId: "ada", door: "session" } as const;
const remembered = {
	node: "fresh",
	scope: "",
	keys: 1,
	value: "seen",
	runId: "run-1",
	updatedAt: 1,
};

describe("listNodeMemory", () => {
	test("lists what the nodes of a flow of a project of the Space remember", async () => {
		const ports = inMemoryEditingPorts();
		ports.memory.remembered.push(remembered);
		expect(
			await listNodeMemory(ports)(ada, {
				spaceId: "space",
				projectId: "project",
				flowName: "build",
			}),
		).toEqual([remembered]);
	});

	test("a project of another Space is not found", async () => {
		const ports = inMemoryEditingPorts();
		const list = listNodeMemory(ports)(ada, {
			spaceId: "space",
			projectId: "elsewhere",
			flowName: "build",
		});
		await expect(list).rejects.toThrow("This project does not exist.");
	});
});
