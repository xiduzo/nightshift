import { describe, expect, test } from "bun:test";
import { flowSchema, singleAgentFlow } from "@nightshift/flows";
import { allowing } from "../../../access/adapters/out/in-memory-access";
import { inMemoryEditingPorts } from "../adapters/out/in-memory-neighbours";
import { removeFlow } from "./remove-flow";

const ada = { personId: "ada", door: "session" } as const;
const quick = flowSchema.parse(
	singleAgentFlow({
		prompt: "Write",
		model: "sonnet",
		permissionMode: "acceptEdits",
	}),
);

describe("removeFlow", () => {
	test("removes the flow of a project of the Space", async () => {
		const ports = inMemoryEditingPorts();
		await ports.flows.save("project", "build", quick);
		await removeFlow(ports)(ada, {
			spaceId: "space",
			projectId: "project",
			name: "build",
		});
		expect(await ports.flows.flows("project")).toEqual({});
	});

	test("a project of another Space is not found", async () => {
		const ports = inMemoryEditingPorts();
		const remove = removeFlow(ports)(ada, {
			spaceId: "space",
			projectId: "elsewhere",
			name: "build",
		});
		await expect(remove).rejects.toThrow("This project does not exist.");
	});

	test("owners, admins and members may, and nobody else", async () => {
		const ports = inMemoryEditingPorts();
		await ports.flows.save("project", "build", quick);
		expect(
			await ports.access.whoMay("space", (actor) =>
				removeFlow(ports)(actor, {
					spaceId: "space",
					projectId: "project",
					name: "build",
				}),
			),
		).toEqual(allowing("owner", "admin", "member"));
	});
});
