import { describe, expect, test } from "bun:test";
import { type Flow, flowSchema, singleAgentFlow } from "@nightshift/flows";
import { inMemoryStorePorts } from "../adapters/out/in-memory-neighbours";
import { readProjectFlows } from "./read-project-flows";

const quick = (prompt: string): Flow =>
	flowSchema.parse(
		singleAgentFlow({ prompt, model: "sonnet", permissionMode: "acceptEdits" }),
	);

describe("readProjectFlows", () => {
	test("reads the flows of the Project", async () => {
		const ports = inMemoryStorePorts();
		await ports.store.save("project", {
			name: "build",
			flow: quick("Write"),
			kind: "save",
			personId: null,
			deviceId: "laptop",
			at: 1,
		});
		const flows = await readProjectFlows(ports)({ projectId: "project" });
		expect(Object.keys(flows)).toEqual(["build"]);
		expect(ports.store.reads).toEqual(["project"]);
	});

	test("refuses a Project this Replica does not have, and reads nothing", async () => {
		const ports = inMemoryStorePorts();
		const read = readProjectFlows(ports)({ projectId: "gone" });
		await expect(read).rejects.toThrow("This project does not exist.");
		expect(ports.store.reads).toEqual([]);
	});
});
