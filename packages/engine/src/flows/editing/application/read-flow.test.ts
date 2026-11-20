import { describe, expect, test } from "bun:test";
import { flowSchema, singleAgentFlow } from "@nightshift/flows";
import { inMemoryEditingPorts } from "../adapters/out/in-memory-neighbours";
import { readFlow } from "./read-flow";

const ada = { personId: "ada", door: "session" } as const;
const quick = flowSchema.parse(
	singleAgentFlow({
		prompt: "Write",
		model: "sonnet",
		permissionMode: "acceptEdits",
	}),
);

describe("readFlow", () => {
	test("reads one flow of a project of the Space", async () => {
		const ports = inMemoryEditingPorts();
		await ports.flows.save("project", "build", quick);
		const loaded = await readFlow(ports)(ada, {
			spaceId: "space",
			projectId: "project",
			name: "build",
		});
		expect(loaded.flow?.nodes).toEqual(quick.nodes);
	});

	test("a project of another Space is not found", async () => {
		const ports = inMemoryEditingPorts();
		const read = readFlow(ports)(ada, {
			spaceId: "space",
			projectId: "elsewhere",
			name: "build",
		});
		await expect(read).rejects.toThrow("This project does not exist.");
	});
});
