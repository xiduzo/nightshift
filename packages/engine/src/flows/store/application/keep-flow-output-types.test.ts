import { describe, expect, test } from "bun:test";
import { type Flow, flowSchema, singleAgentFlow } from "@nightshift/flows";
import { inMemoryStorePorts } from "../adapters/out/in-memory-neighbours";
import { keepFlowOutputTypes } from "./keep-flow-output-types";

const flow: Flow = {
	...flowSchema.parse(
		singleAgentFlow({
			prompt: "Write",
			model: "sonnet",
			permissionMode: "acceptEdits",
		}),
	),
	outputs: [{ name: "summary", value: "{{a.text}}" }],
};
const types = [{ name: "summary", value: "{{a.text}}", type: "string" }];

describe("keepFlowOutputTypes", () => {
	test("keeps the type with a revision of kind infer by Night Shift on this Device", async () => {
		const ports = inMemoryStorePorts();
		await ports.store.save("project", {
			name: "build",
			flow,
			kind: "save",
			personId: "ada",
			deviceId: "laptop",
			at: 1,
		});
		const keep = keepFlowOutputTypes(ports);
		expect(await keep({ projectId: "project", name: "build", types })).toBe(
			true,
		);
		expect(await keep({ projectId: "project", name: "build", types })).toBe(
			false,
		);
		const revisions = await ports.store.revisions("project", "build");
		expect(revisions.map((r) => [r.kind, r.personId, r.at])).toEqual([
			["save", "ada", 1],
			["infer", null, 1000],
		]);
	});

	test("refuses a Project this Replica does not have", async () => {
		const ports = inMemoryStorePorts();
		const keep = keepFlowOutputTypes(ports)({
			projectId: "gone",
			name: "build",
			types,
		});
		await expect(keep).rejects.toThrow("This project does not exist.");
	});
});
