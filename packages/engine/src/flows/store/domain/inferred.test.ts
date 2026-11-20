import { describe, expect, test } from "bun:test";
import { flowSchema, singleAgentFlow } from "@nightshift/flows";
import { nodeWithShape, outputsWithTypes } from "./inferred";
import { readableNotices } from "./notices";

const agent = flowSchema.parse(
	singleAgentFlow({
		prompt: "Write",
		model: "sonnet",
		permissionMode: "acceptEdits",
	}),
).nodes[0];

describe("what a run infers", () => {
	test("a node without a schema takes the shape, marked inferred", () => {
		const shape = { type: "object" };
		expect(nodeWithShape(agent, "agent", { data: shape })).toMatchObject({
			output: shape,
			outputInferred: true,
		});
		expect(nodeWithShape(agent, "command", { data: shape })).toBeNull();
		expect(nodeWithShape(undefined, "agent", { data: shape })).toBeNull();
		expect(
			nodeWithShape({ ...agent, output: shape }, "agent", { data: shape }),
		).toBeNull();
	});

	test("an output without a type takes the run's type, a person's type wins", () => {
		const types = [{ name: "summary", value: "{{a.text}}", type: "string" }];
		expect(
			outputsWithTypes([{ name: "summary", value: "{{a.text}}" }], types),
		).toEqual([
			{ name: "summary", value: "{{a.text}}", type: "string", inferred: true },
		]);
		expect(
			outputsWithTypes(
				[{ name: "summary", value: "{{a.text}}", type: "number" }],
				types,
			),
		).toBeNull();
		expect(outputsWithTypes(undefined, types)).toBeNull();
	});

	test("notices read oldest first, and one that does not read is left out", () => {
		const notice = {
			at: 2,
			deviceId: "laptop",
			kind: "folder-kept",
			message: "Kept.",
		};
		expect(
			readableNotices([
				["b", notice],
				["a", { ...notice, at: 1 }],
				["c", { nope: true }],
			]).map((read) => read.id),
		).toEqual(["a", "b"]);
	});
});
