import { describe, expect, test } from "bun:test";
import { flowSchema, singleAgentFlow } from "@nightshift/flows";
import { inMemoryStorePorts } from "../adapters/out/in-memory-neighbours";
import { keepFlowShapes } from "./keep-flow-shapes";

const flow = flowSchema.parse(
	singleAgentFlow({
		prompt: "Write",
		model: "sonnet",
		permissionMode: "acceptEdits",
	}),
);
const node = flow.nodes[0] ?? { id: "", type: "" };

describe("keepFlowShapes", () => {
	test("keeps the shape with a revision of kind infer by Night Shift on this Device", async () => {
		const ports = inMemoryStorePorts();
		await ports.store.save("project", {
			name: "build",
			flow,
			kind: "save",
			personId: "ada",
			deviceId: "desktop",
			at: 1,
		});
		const keep = keepFlowShapes(ports);
		const request = {
			projectId: "project",
			name: "build",
			node: { id: node.id, type: node.type },
			shapes: { data: { type: "object" } },
		};
		expect(await keep(request)).toBe(true);
		// A schema it kept is a schema: the next run keeps nothing.
		expect(await keep(request)).toBe(false);
		const revisions = await ports.store.revisions("project", "build");
		expect(
			revisions.map((r) => [r.kind, r.personId, r.deviceId, r.at]),
		).toEqual([
			["save", "ada", "desktop", 1],
			["infer", null, "laptop", 1000],
		]);
	});

	test("keeps nothing for a flow that is gone", async () => {
		const ports = inMemoryStorePorts();
		expect(
			await keepFlowShapes(ports)({
				projectId: "project",
				name: "gone",
				node: { id: node.id, type: node.type },
				shapes: { data: {} },
			}),
		).toBe(false);
	});

	test("refuses a Project this Replica does not have", async () => {
		const ports = inMemoryStorePorts();
		const keep = keepFlowShapes(ports)({
			projectId: "gone",
			name: "build",
			node: { id: node.id, type: node.type },
			shapes: {},
		});
		await expect(keep).rejects.toThrow("This project does not exist.");
	});
});
