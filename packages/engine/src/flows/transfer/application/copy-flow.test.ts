import { describe, expect, test } from "bun:test";
import { flowSchema, singleAgentFlow } from "@nightshift/flows";
import { inMemoryTransferPorts } from "../adapters/out/in-memory-neighbours";
import { copyFlow } from "./copy-flow";

const ada = { personId: "ada", door: "session" } as const;
const quick = flowSchema.parse(
	singleAgentFlow({
		prompt: "Write",
		model: "sonnet",
		permissionMode: "acceptEdits",
	}),
);
const request = {
	spaceId: "space",
	projectId: "project",
	name: "build",
	to: { projectId: "other", name: "build" },
};

describe("copyFlow", () => {
	test("saves the flow in the other project as a copy by the Person, and notes it", async () => {
		const ports = inMemoryTransferPorts();
		await ports.flows.save("project", "build", quick);
		expect(await copyFlow(ports)(ada, request)).toEqual({
			name: "build",
			issues: [],
		});
		expect(ports.flows.saves.at(-1)).toEqual({
			projectId: "other",
			name: "build",
			flow: quick,
			kind: "copy",
			personId: "ada",
		});
		expect(ports.usage.notes).toEqual([{ kind: "flow-created", from: "copy" }]);
	});

	test("refuses a name the other project has already, and suggests a free one", async () => {
		const ports = inMemoryTransferPorts();
		await ports.flows.save("project", "build", quick);
		await ports.flows.save("other", "build", quick);
		await expect(copyFlow(ports)(ada, request)).rejects.toMatchObject({
			kind: "conflict",
			message:
				'That project has a flow named "build" already. Copy it as "build-2" instead.',
		});
	});

	test("checks both projects are in the Space", async () => {
		const ports = inMemoryTransferPorts();
		await expect(
			copyFlow(ports)(ada, {
				...request,
				to: { projectId: "elsewhere", name: "build" },
			}),
		).rejects.toMatchObject({ kind: "not-found" });
		expect(ports.projects.checked).toEqual([
			{ projectId: "project", spaceId: "space" },
			{ projectId: "elsewhere", spaceId: "space" },
		]);
	});
});
