import { describe, expect, test } from "bun:test";
import { flowSchema, singleAgentFlow } from "@nightshift/flows";
import { allowing } from "../../../access/adapters/out/in-memory-access";
import { inMemoryEditingPorts } from "../adapters/out/in-memory-neighbours";
import { readFlowMap } from "./read-flow-map";

const ada = { personId: "ada", door: "session" } as const;
const quick = flowSchema.parse(
	singleAgentFlow({
		prompt: "Write",
		model: "sonnet",
		permissionMode: "acceptEdits",
	}),
);

describe("readFlowMap", () => {
	test("reads every flow of a project of the Space by name", async () => {
		const ports = inMemoryEditingPorts();
		await ports.flows.save("project", "build", quick);
		const map = await readFlowMap(ports)(ada, {
			spaceId: "space",
			projectId: "project",
		});
		expect(Object.keys(map)).toEqual(["build"]);
	});

	test("a project of another Space is not found", async () => {
		const ports = inMemoryEditingPorts();
		const read = readFlowMap(ports)(ada, {
			spaceId: "space",
			projectId: "elsewhere",
		});
		await expect(read).rejects.toThrow("This project does not exist.");
	});

	test("every Member of the Space may, whatever the role, and nobody else", async () => {
		const ports = inMemoryEditingPorts();
		expect(
			await ports.access.whoMay("space", (actor) =>
				readFlowMap(ports)(actor, { spaceId: "space", projectId: "project" }),
			),
		).toEqual(allowing("owner", "admin", "member", "viewer"));
	});
});
