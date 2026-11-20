import { describe, expect, test } from "bun:test";
import { flowSchema, singleAgentFlow } from "@nightshift/flows";
import { inMemoryStorePorts } from "../adapters/out/in-memory-neighbours";
import { removeProjectFlow } from "./remove-project-flow";

describe("removeProjectFlow", () => {
	test("removes the flow, and its revisions stay", async () => {
		const ports = inMemoryStorePorts();
		await ports.store.save("project", {
			name: "build",
			flow: flowSchema.parse(
				singleAgentFlow({
					prompt: "Write",
					model: "sonnet",
					permissionMode: "acceptEdits",
				}),
			),
			kind: "save",
			personId: null,
			deviceId: "laptop",
			at: 1,
		});
		await removeProjectFlow(ports)({ projectId: "project", name: "build" });
		const here = { deviceId: "laptop", spaceId: "space" };
		expect(await ports.store.read("project", here)).toEqual({});
	});

	test("refuses a flow that does not exist", async () => {
		const ports = inMemoryStorePorts();
		const remove = removeProjectFlow(ports)({
			projectId: "project",
			name: "gone",
		});
		await expect(remove).rejects.toThrow('The flow "gone" does not exist.');
	});

	test("refuses a Project this Replica does not have", async () => {
		const ports = inMemoryStorePorts();
		const remove = removeProjectFlow(ports)({
			projectId: "gone",
			name: "build",
		});
		await expect(remove).rejects.toThrow("This project does not exist.");
	});
});
