import { describe, expect, test } from "bun:test";
import { flowSchema, singleAgentFlow } from "@nightshift/flows";
import { inMemoryEditingPorts } from "../adapters/out/in-memory-neighbours";
import { listFlowRevisions } from "./list-flow-revisions";

const ada = { personId: "ada", door: "session" } as const;
const quick = (prompt: string) =>
	flowSchema.parse(
		singleAgentFlow({ prompt, model: "sonnet", permissionMode: "acceptEdits" }),
	);

describe("listFlowRevisions", () => {
	test("lists the revisions newest first, with who saved each and on which Device", async () => {
		const ports = inMemoryEditingPorts();
		await ports.flows.save("project", "build", quick("One"), {
			personId: "ada",
		});
		await ports.flows.save("project", "build", quick("Two"));
		const list = await listFlowRevisions(ports)(ada, {
			spaceId: "space",
			projectId: "project",
			name: "build",
		});
		expect(
			list.map((item) => [item.person, item.device.name, item.current]),
		).toEqual([
			[null, "Laptop", true],
			[{ id: "ada", name: "Ada" }, "Laptop", false],
		]);
		// The newer one changed the prompt of the older one.
		expect(list[0]?.changes).not.toBeNull();
		expect(list[1]?.changes).toBeNull();
	});

	test("a flow that does not exist is not found", async () => {
		const ports = inMemoryEditingPorts();
		const list = listFlowRevisions(ports)(ada, {
			spaceId: "space",
			projectId: "project",
			name: "gone",
		});
		await expect(list).rejects.toThrow('The flow "gone" does not exist.');
	});

	test("a project of another Space is not found", async () => {
		const ports = inMemoryEditingPorts();
		const list = listFlowRevisions(ports)(ada, {
			spaceId: "space",
			projectId: "elsewhere",
			name: "build",
		});
		await expect(list).rejects.toThrow("This project does not exist.");
	});
});
