import { describe, expect, test } from "bun:test";
import { flowSchema, singleAgentFlow } from "@nightshift/flows";
import { inMemoryEditingPorts } from "../adapters/out/in-memory-neighbours";
import { listFlows } from "./list-flows";

const ada = { personId: "ada", door: "session" } as const;
const quick = flowSchema.parse(
	singleAgentFlow({
		prompt: "Write",
		model: "sonnet",
		permissionMode: "acceptEdits",
	}),
);

describe("listFlows", () => {
	test("lists the flows of a project of the Space", async () => {
		const ports = inMemoryEditingPorts();
		await ports.flows.save("project", "build", quick);
		const list = await listFlows(ports)(ada, {
			spaceId: "space",
			projectId: "project",
		});
		expect(list.map((item) => item.name)).toEqual(["build"]);
		expect(ports.projects.checked).toEqual([
			{ projectId: "project", spaceId: "space" },
		]);
	});

	test("a project of another Space is not found", async () => {
		const ports = inMemoryEditingPorts();
		const list = listFlows(ports)(ada, {
			spaceId: "space",
			projectId: "elsewhere",
		});
		await expect(list).rejects.toThrow("This project does not exist.");
	});
});
